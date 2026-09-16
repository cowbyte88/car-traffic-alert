// Vercel Edge Function: triggered by an iOS Shortcuts automation (Bluetooth car connect)
// -> checks live traffic time + incidents from home to two destinations via TomTom
// -> pushes a summary notification via ntfy.sh

export const config = { runtime: "edge" };

const TRAFFIC_EMOJI = (delayMin) => {
  if (delayMin >= 15) return "🔴";
  if (delayMin >= 5) return "🟡";
  return "🟢";
};

async function geocode(address, apiKey) {
  const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json?key=${apiKey}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocode failed for "${address}": ${res.status}`);
  const data = await res.json();
  const first = data.results && data.results[0];
  if (!first) throw new Error(`No geocode result for "${address}"`);
  return { lat: first.position.lat, lon: first.position.lon };
}

async function routeWithTraffic(origin, dest, apiKey) {
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${origin.lat},${origin.lon}:${dest.lat},${dest.lon}/json` +
    `?key=${apiKey}&traffic=true&computeTravelTimeFor=all&sectionType=traffic&travelMode=car`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing failed: ${res.status}`);
  const data = await res.json();
  const route = data.routes && data.routes[0];
  if (!route) throw new Error("No route found");

  const summary = route.legs[0].summary;
  const trafficSec = summary.liveTrafficIncidentsTravelTimeInSeconds ?? summary.travelTimeInSeconds;
  const noTrafficSec = summary.noTrafficTravelTimeInSeconds ?? trafficSec;

  const heavySections = (route.sections || []).filter(
    (s) => s.sectionType === "TRAFFIC" && (s.magnitudeOfDelay ?? 0) >= 2
  );

  // Bounding box of the route's own points, padded a bit, for incident lookup.
  const points = (route.legs[0].points || []).concat([origin, dest]);
  const lats = points.map((p) => p.latitude ?? p.lat);
  const lons = points.map((p) => p.longitude ?? p.lon);
  const pad = 0.01;
  const bbox = [
    Math.min(...lons) - pad,
    Math.min(...lats) - pad,
    Math.max(...lons) + pad,
    Math.max(...lats) + pad,
  ];

  return { trafficSec, noTrafficSec, heavySections, bbox };
}

async function incidentsInBbox(bbox, apiKey) {
  const fields = "{incidents{properties{iconCategory,magnitudeOfDelay,events{description,iconCategory}}}}";
  const url =
    `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${bbox.join(",")}` +
    `&fields=${encodeURIComponent(fields)}&language=pt-BR&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return []; // incidents are a bonus; don't fail the whole request over this
  const data = await res.json();
  const incidents = data.incidents || [];
  // 1 = Accident, 8 = Road Closed, 9 = Road Works (only surface the serious ones)
  const relevant = incidents.filter((i) => [1, 8, 9].includes(i.properties?.iconCategory));
  return relevant.slice(0, 2).map((i) => {
    const desc = i.properties?.events?.[0]?.description;
    return desc || iconCategoryLabel(i.properties?.iconCategory);
  });
}

function iconCategoryLabel(code) {
  return { 1: "Acidente", 8: "Via fechada", 9: "Obra na via" }[code] || "Incidente";
}

async function describeLeg(label, origin, dest, apiKey) {
  const { trafficSec, noTrafficSec, heavySections, bbox } = await routeWithTraffic(origin, dest, apiKey);
  const trafficMin = Math.round(trafficSec / 60);
  const noTrafficMin = Math.round(noTrafficSec / 60);
  const delayMin = Math.max(0, trafficMin - noTrafficMin);
  const emoji = TRAFFIC_EMOJI(delayMin);

  let line = `${emoji} ${label}: ${trafficMin} min (normal ${noTrafficMin} min)`;

  const incidents = await incidentsInBbox(bbox, apiKey);
  const flags = new Set(incidents);
  if (heavySections.length > 0 && incidents.length === 0) {
    flags.add("Trânsito pesado no trajeto");
  }
  for (const flag of flags) {
    line += `\n   ⚠️ ${flag}`;
  }
  return line;
}

async function sendNtfy(topic, title, message) {
  await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers: {
      Title: title,
      Priority: "default",
      Tags: "car,traffic",
    },
    body: message,
  });
}

export default async function handler(request) {
  const url = new URL(request.url);
  const env = process.env;

  if (url.searchParams.get("key") !== env.AUTH_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const apiKey = env.TOMTOM_API_KEY;
    const home = await geocode(env.HOME_ADDRESS, apiKey);
    const boca = await geocode(env.DEST_BOCA, apiKey);
    const pbg = await geocode(env.DEST_PBG, apiKey);

    const [lineBoca, linePbg] = await Promise.all([
      describeLeg("RMBJJ (Delray)", home, boca, apiKey),
      describeLeg("LifeTime (PBG)", home, pbg, apiKey),
    ]);

    const message = `${lineBoca}\n\n${linePbg}`;
    await sendNtfy(env.NTFY_TOPIC, "Trânsito ao saír de casa", message);

    return new Response(message, { status: 200 });
  } catch (err) {
    await sendNtfy(env.NTFY_TOPIC, "Erro no alerta de trânsito", String(err.message || err));
    return new Response(`Error: ${err.message || err}`, { status: 500 });
  }
}
