# Decibel Guardian Bot

Your personal liquidation defense system for Decibel. This bot monitors your perp positions in real-time and alerts you via Telegram before you get liquidated.

## Features

*   **Instant Liquidation Alerts**: Get notified when your position is close to liquidation (< 1s latency).
*   **Multi-Wallet Monitoring**: Track up to 5 wallets simultaneously.
*   **Whale Tracking**: Spy on other traders' new positions with `/track`.
*   **Price Alerts**: Set custom price targets for any market.
*   **Account Stats**: View detailed PnL, Win Rate, and Volume analysis.
*   **Interactive Settings**: Adjust alert thresholds and durations instantly.

## Commands

| Command | Description | Example |
| :--- | :--- | :--- |
| `/start` | Dashboard & Quick Setup | `/start` |
| `/status` | View Active Positions & PnL | `/status` |
| `/account` | Portfolio Overview | `/account` |
| `/wallets` | Manage your wallets | `/wallets` |
| `/addwallet` | Add another wallet | `/addwallet 0x123... Degen` |
| `/settings` | Configure Alert Thresholds | `/settings` |
| `/track` | Track whale positions | `/track 0x456...` |
| `/untrack` | Stop tracking a wallet | `/untrack 0x456...` |
| `/tracking` | List tracked wallets | `/tracking` |
| `/alert` | Set price target | `/alert BTC 65000` |
| `/alerts` | View active alerts | `/alerts` |
| `/stop` | Stop monitoring | `/stop` |

## Deployment

### Prerequisites
*   Node.js
*   Telegram Bot Token (@BotFather)
*   Decibel API Key

### Local Run
1.  Clone repo
2.  `npm install`
3.  Create `.env` with `TELEGRAM_BOT_TOKEN` and `DECIBEL_API_KEY`
4.  `npm start`

### Render Deployment
1.  Create New Web Service on Render.
2.  Connect this repository.
3.  Add Environment Variables in Render Dashboard.
4.  Deploy!

---
built by [ololade_eth](https://x.com/ololade_eth)
