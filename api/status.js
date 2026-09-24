// Vercel Edge Function: read-only traffic snapshot for the boat app's "Trânsito" tab.
// No auth token, no ntfy push — just returns current TomTom conditions on demand.
// Kept separate from check.js (the Bluetooth/geofence alert) so that flow is untouched.

export const config = { runtime: "edge" };

const ALLOWED_ORIGIN = "https://cowbyte88.github.io";

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

function iconCategoryLabel(code) {
  return { 1: "Acidente", 8: "Via fechada", 9: "Obra na via" }[code] || "Incidente";
}

async function incidentsInBbox(bbox, apiKey) {
  const fields = "{incidents{properties{iconCategory,magnitudeOfDelay,events{description,iconCategory}}}}";
  const url =
    `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${bbox.join(",")}` +
    `&fields=${encodeURIComponent(fields)}&language=pt-BR&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const incidents = data.incidents || [];
  const relevant = incidents.filter((i) => [1, 8, 9].includes(i.properties?.iconCategory));
  return relevant.slice(0, 3).map((i) => {
    const desc = i.properties?.events?.[0]?.description;
    return desc || iconCategoryLabel(i.properties?.iconCategory);
  });
}

async function legStatus(label, origin, dest, apiKey) {
  const { trafficSec, noTrafficSec, heavySections, bbox } = await routeWithTraffic(origin, dest, apiKey);
  const trafficMin = Math.round(trafficSec / 60);
  const noTrafficMin = Math.round(noTrafficSec / 60);
  const delayMin = Math.max(0, trafficMin - noTrafficMin);
  const incidents = await incidentsInBbox(bbox, apiKey);
  const heavyTraffic = heavySections.length > 0 && incidents.length === 0;

  let severity = "good";
  if (delayMin >= 15) severity = "bad";
  else if (delayMin >= 5) severity = "warn";

  return { label, trafficMin, noTrafficMin, delayMin, severity, incidents, heavyTraffic };
}

export default async function handler(request) {
  const env = process.env;
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "cache-control": "public, max-age=45",
  };

  try {
    const apiKey = env.TOMTOM_API_KEY;
    const home = await geocode(env.HOME_ADDRESS, apiKey);
    const boca = await geocode(env.DEST_BOCA, apiKey);
    const pbg = await geocode(env.DEST_PBG, apiKey);

    const [south, north] = await Promise.all([
      legStatus("Hypoluxo → Boca/Delray (sul)", home, boca, apiKey),
      legStatus("Hypoluxo → Palm Beach Gardens (norte)", home, pbg, apiKey),
    ]);

    return new Response(JSON.stringify({ south, north, updated: new Date().toISOString() }), {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err) }), {
      status: 500,
      headers,
    });
  }
}
