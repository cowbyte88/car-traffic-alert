# car-traffic-alert

Quando o iPhone conecta no Bluetooth do carro, dispara um push (via [ntfy.sh](https://ntfy.sh))
com o tempo de viagem atual (com trânsito) de casa até dois destinos, comparado com o tempo
normal, e sinaliza acidentes/obras/trânsito pesado no caminho — usando a [TomTom Routing +
Traffic API](https://developer.tomtom.com/).

Destinos configurados hoje (em `wrangler.toml`, fácil de editar):
- RMBJJ Academy, Delray Beach, FL
- LifeTime, Palm Beach Gardens, FL

## Arquitetura

```
iPhone (Bluetooth do carro conecta)
  -> Shortcuts (automação, sem confirmação)
    -> GET https://car-traffic-alert.<seu-subdominio>.workers.dev/?key=SEU_TOKEN
      -> Cloudflare Worker
         -> TomTom Geocoding (endereço -> lat/lon)
         -> TomTom Routing (tempo com trânsito x tempo normal, seções de trânsito)
         -> TomTom Traffic Incident Details (acidentes/obras na bbox da rota)
         -> POST https://ntfy.sh/SEU_TOPICO
      <- notificação chega no app ntfy do iPhone
```

Nenhum dado sensível (endereço de casa, token, tópico do ntfy) fica no código —
tudo é configurado como **secret** do Cloudflare Worker.

## Setup

### 1. Pré-requisitos
- Node.js instalado
- Conta grátis na [TomTom Developer Portal](https://developer.tomtom.com/) -> criar uma API Key
  (free tier: 2.500 requests/dia, sem cartão de crédito)
- Conta grátis na [Cloudflare](https://dash.cloudflare.com/sign-up)
- App **ntfy** instalado no iPhone (App Store)

### 2. Instalar dependências e logar na Cloudflare
```bash
npm install
npx wrangler login
```

### 3. Configurar os secrets
```bash
npx wrangler secret put TOMTOM_API_KEY
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put HOME_ADDRESS
npx wrangler secret put NTFY_TOPIC
```
- `AUTH_TOKEN`: qualquer string longa aleatória (ex: `openssl rand -hex 16`) — protege o
  webhook pra ninguém além de você conseguir disparar o alerta.
- `HOME_ADDRESS`: seu endereço completo (ex: `1214 N Atlantic Dr, Lantana, FL 33462`).
- `NTFY_TOPIC`: um nome difícil de adivinhar (ex: `rr-car-traffic-x7f2`) — funciona como senha
  do seu canal de notificação.

### 4. Deploy
```bash
npm run deploy
```
Isso imprime a URL do worker, algo como `https://car-traffic-alert.SEUUSUARIO.workers.dev`.

### 5. Testar
```bash
curl "https://car-traffic-alert.SEUUSUARIO.workers.dev/?key=SEU_AUTH_TOKEN"
```
Deve retornar o texto do resumo e chegar uma notificação no app ntfy (depois de você se
inscrever no tópico: abra o app ntfy no iPhone -> "+" -> cole o valor de `NTFY_TOPIC`).

## Automação no iPhone (Shortcuts)

1. Abra o app **Atalhos (Shortcuts)** -> aba **Automação** -> **+** -> **Criar Automação Pessoal**.
2. Escolha **Bluetooth** -> selecione o dispositivo Bluetooth do seu carro -> **Conectado**.
3. Na tela seguinte, **desmarque "Perguntar Antes de Executar"** (senão ele pede confirmação
   toda vez) e escolha **Executar Imediatamente**.
4. Adicione a ação **Obter Conteúdo de URL**:
   - URL: `https://car-traffic-alert.SEUUSUARIO.workers.dev/?key=SEU_AUTH_TOKEN`
   - Método: GET
5. Salve. Pronto — ao conectar no Bluetooth do carro, o worker roda e a notificação chega via ntfy.

## Ajustes futuros possíveis
- Trocar os destinos: editar `DEST_BOCA` / `DEST_PBG` em `wrangler.toml` e rodar `npm run deploy`.
- Adicionar um terceiro destino: copiar o padrão de `describeLeg` em `src/index.js`.
- Ajustar os limiares de cor (🟢🟡🔴) em `TRAFFIC_EMOJI` em `src/index.js`.
- Trocar ntfy.sh por Pushover se quiser algo mais "polido" (ícone, som customizado).
