# car-traffic-alert

Quando o iPhone conecta no Bluetooth do carro, dispara um push (via [ntfy.sh](https://ntfy.sh))
com o tempo de viagem atual (com trânsito) de casa até dois destinos, comparado com o tempo
normal, e sinaliza acidentes/obras/trânsito pesado no caminho — usando a [TomTom Routing +
Traffic API](https://developer.tomtom.com/).

Destinos configurados hoje (variáveis de ambiente `DEST_BOCA` / `DEST_PBG`, fácil de editar
no painel da Vercel sem precisar mudar código):
- RMBJJ Academy, Delray Beach, FL
- LifeTime, Palm Beach Gardens, FL

## Arquitetura

```
iPhone (Bluetooth do carro conecta)
  -> Shortcuts (automação, sem confirmação)
    -> GET https://SEU-PROJETO.vercel.app/api/check?key=SEU_TOKEN
      -> Vercel Edge Function (api/check.js)
         -> TomTom Geocoding (endereço -> lat/lon)
         -> TomTom Routing (tempo com trânsito x tempo normal, seções de trânsito)
         -> TomTom Traffic Incident Details (acidentes/obras na bbox da rota)
         -> POST https://ntfy.sh/SEU_TOPICO
      <- notificação chega no app ntfy do iPhone
```

Nenhum dado sensível (endereço de casa, token, tópico do ntfy) fica no código —
tudo é configurado como **Environment Variable** do projeto na Vercel.

## Setup (deploy 100% pelo navegador, sem instalar nada localmente)

### 1. Pré-requisitos
- Conta grátis na [TomTom Developer Portal](https://developer.tomtom.com/) -> criar uma API Key
  (free tier: 2.500 requests/dia, sem cartão de crédito)
- Conta grátis na [Vercel](https://vercel.com/signup) (pode entrar com a conta do GitHub)
- App **ntfy** instalado no iPhone (App Store)

### 2. Importar o repositório na Vercel
1. Acesse [vercel.com/new](https://vercel.com/new).
2. Autorize o acesso ao GitHub (se ainda não tiver) e selecione o repositório
   `cowbyte88/car-traffic-alert`.
3. Não precisa mudar nenhuma configuração de build — a Vercel detecta a pasta `api/`
   automaticamente. Antes de clicar em Deploy, adicione as variáveis de ambiente (próximo passo).

### 3. Configurar as Environment Variables
Em **Project Settings -> Environment Variables**, adicione (marcadas para Production **e** Preview):

| Nome | Valor | Observação |
|---|---|---|
| `TOMTOM_API_KEY` | sua API key da TomTom | secreta |
| `AUTH_TOKEN` | uma string longa aleatória | protege o endpoint — só quem sabe consegue disparar |
| `HOME_ADDRESS` | seu endereço completo | secreta — nunca vai pro código/repo |
| `NTFY_TOPIC` | um nome difícil de adivinhar | funciona como senha do seu canal de notificação |
| `DEST_BOCA` | `RMBJJ Academy, Delray Beach, FL` | pode editar livremente |
| `DEST_PBG` | `LifeTime, Palm Beach Gardens, FL` | pode editar livremente |

Depois de salvar as variáveis, clique em **Deploy**. A cada novo `git push` no repositório,
a Vercel faz o redeploy automaticamente.

### 4. Testar
A URL final é algo como `https://car-traffic-alert.vercel.app/api/check`.
```bash
curl "https://car-traffic-alert.vercel.app/api/check?key=SEU_AUTH_TOKEN"
```
Deve retornar o texto do resumo e chegar uma notificação no app ntfy (depois de você se
inscrever no tópico: abra o app ntfy no iPhone -> "+" -> cole o valor de `NTFY_TOPIC`).

## Automação no iPhone (Shortcuts)

1. Abra o app **Atalhos (Shortcuts)** -> aba **Automação** -> **+** -> **Criar Automação Pessoal**.
2. Escolha **Bluetooth** -> selecione o dispositivo Bluetooth do seu carro -> **Conectado**.
3. Na tela seguinte, **desmarque "Perguntar Antes de Executar"** (senão ele pede confirmação
   toda vez) e escolha **Executar Imediatamente**.
4. Adicione a ação **Obter Conteúdo de URL**:
   - URL: `https://car-traffic-alert.vercel.app/api/check?key=SEU_AUTH_TOKEN`
   - Método: GET
5. Salve. Pronto — ao conectar no Bluetooth do carro, a function roda e a notificação chega via ntfy.

## Ajustes futuros possíveis
- Trocar os destinos: editar `DEST_BOCA` / `DEST_PBG` direto no painel da Vercel (não precisa
  redeploy manual, só salvar a variável já dispara um novo build).
- Adicionar um terceiro destino: copiar o padrão de `describeLeg` em `api/check.js`.
- Ajustar os limiares de cor (🟢🟡🔴) em `TRAFFIC_EMOJI` em `api/check.js`.
- Trocar ntfy.sh por Pushover se quiser algo mais "polido" (ícone, som customizado).
