require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const decibel = require('./decibel_client');

// Initialize Bot
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || token === 'YOUR_TOKEN_HERE') {
    console.error("TELEGRAM_BOT_TOKEN not found or invalid in .env file!");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Render Health Check Server
const http = require('http');
const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Decibel Guardian is running.\n');
});
server.listen(port, () => {
    console.log(`Health check server running on port ${port}`);
});


// Store subscribed users: { chatId: { walletAddress, alertThreshold, alertDuration, lastAlerts } }
const subscribedUsers = {};

console.log("🤖 Decibel Liquidation Alert Bot starting...");
bot.on('polling_error', (error) => {
    console.log('Detailed Polling Error:', JSON.stringify(error));
    console.log('Error Code:', error.code);
    console.log('Error Message:', error.message);
});

// --- Callback Query Handler (for Buttons) ---
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const command = callbackQuery.data;
    const chatId = message.chat.id;
    const user = subscribedUsers[chatId]; // Get user for helpers

    // Acknowledge the callback to stop the loading animation on the button
    bot.answerCallbackQuery(callbackQuery.id);

    // Helper to edit message safely
    const editMsg = async (text, options) => {
        try {
            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: message.message_id,
                parse_mode: 'Markdown',
                reply_markup: options.reply_markup
            });
        } catch (e) {
            // Ignore "message is not modified" errors
            if (!e.message.includes('message is not modified')) {
                console.error("Failed to edit message:", e.message);
            }
        }
    };

    if (command === 'status') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        migrateUser(user);
        await editMsg("⏳ **Fetching Status...**", { reply_markup: {} }); // Loading state
        const { text, options } = await getStatusMessage(chatId, user);
        await editMsg(text, options);

    } else if (command === 'account') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        migrateUser(user);
        await editMsg("⏳ **Fetching Account Stats...**", { reply_markup: {} });
        const { text, options } = await getAccountMessage(chatId, user);
        await editMsg(text, options);

    } else if (command === 'tracking') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        const { text, options } = getTrackingMessage(user);
        await editMsg(text, options);

    } else if (command === 'alerts') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        await editMsg("⏳ **Fetching Active Alerts...**", { reply_markup: {} });
        const { text, options } = await getAlertsMessage(user);
        await editMsg(text, options);

    } else if (command === 'wallets') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        migrateUser(user);
        const { text, options } = getWalletsMessage(user);
        await editMsg(text, options);


    } else if (command === 'settings') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        const { text, options } = getSettingsMessage(user);
        await editMsg(text, options);

    } else if (command === 'set_t_up') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        user.alertThreshold += 1;
        const { text, options } = getSettingsMessage(user);
        await editMsg(text, options);

    } else if (command === 'set_t_down') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        if (user.alertThreshold > 1) user.alertThreshold -= 1;
        const { text, options } = getSettingsMessage(user);
        await editMsg(text, options);

    } else if (command === 'set_d_up') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        user.alertDuration += 60;
        const { text, options } = getSettingsMessage(user);
        await editMsg(text, options);

    } else if (command === 'set_d_down') {
        if (!user) {
            const { text, options } = getOnboardingMessage();
            await editMsg(text, options);
            return;
        }
        if (user.alertDuration > 60) user.alertDuration -= 60;
        const { text, options } = getSettingsMessage(user);
        await editMsg(text, options);

    } else if (command === 'noop') {
        // Do nothing
    } else if (command === 'start') {
        const { text, options } = getDashboardMessage();
        await editMsg(text, options);

    } else if (command.startsWith('switch_')) {
        const walletName = command.replace('switch_', '');

        if (user && user.wallets[walletName]) {
            user.activeWallet = walletName;
            bot.answerCallbackQuery(callbackQuery.id, { text: `Switched to ${walletName}` });

            // Refresh the keyboard to show new checkmark
            const { text, options } = getWalletsMessage(user);
            await editMsg(text, options);
        } else {
            bot.answerCallbackQuery(callbackQuery.id, { text: `Wallet not found.` });
        }
    }
});

// --- Command Handlers ---

// Helper to ensure user data is migrated to multi-wallet structure
function migrateUser(user) {
    if (user.walletAddress && !user.wallets) {
        user.wallets = { "Main": user.walletAddress };
        user.activeWallet = "Main";
        delete user.walletAddress; // Optional: keep for safety or delete
    }
    if (!user.wallets) user.wallets = {};
    if (!user.activeWallet && Object.keys(user.wallets).length > 0) {
        user.activeWallet = Object.keys(user.wallets)[0];
    }
}

// /start <wallet_address> [threshold] [duration]
// Helper to generate Dashboard Message and Options
function getDashboardMessage() {
    const text = `🛡️ **Decibel Guardian**\n\n` +
        `**Welcome!** I am your liquidation defense system.\n` +
        `I monitor your positions in real-time to keep your funds safe.\n\n` +
        `**🚀 Features:**\n` +
        `• **Real-Time Tracking**: Alerts < 1 second latency.\n` +
        `• **Multi-Wallet**: Track up to 5 wallets safely.\n` +
        `• **New Position Spy**: Track other traders with \`/track\`.\n\n` +
        `**📋 Usage:**\n` +
        `\`/start <wallet>\`\n\n` +
        `**📋 Commands:**\n` +
        `\`/start <wallet>\` - Quick setup\n` +
        `\`/addwallet <addr> <name>\` - Add another wallet\n` +

        `\`/track <addr>\` - Spy on a whale's new positions`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📊 Status', callback_data: 'status' },
                    { text: '📈 Account Stats', callback_data: 'account' }
                ],
                [
                    { text: '👛 Wallets', callback_data: 'wallets' },
                    { text: '🔔 Active Alerts', callback_data: 'alerts' }
                ],
                [
                    { text: '🕵️ Tracked Wallets', callback_data: 'tracking' },
                    { text: '⚙️ Settings', callback_data: 'settings' }
                ],
            ]
        }
    };
    return { text, options };
}

// Helper to validate wallet address
function isValidAddress(address) {
    // Basic Check: Starts with 0x and contains only hex characters
    // Aptos addresses are usually 66 chars (0x + 64 hex), but we allow flexibility for short formats if valid on chain
    return /^0x[0-9a-fA-F]+$/.test(address) && address.length > 2;
}

// Helper for Onboarding Message (when user is not registered)
function getOnboardingMessage() {
    const message = `👋 **Welcome to Decibel Guardian!**\n\n` +
        `To get started, I need your wallet address.\n\n` +
        `**Quick Setup:**\n` +
        `\`/start <your_wallet_address>\`\n\n` +
        `**Example:**\n` +
        `\`/start 0x1234567890abcdef...\`\n\n` +
        `Once registered, you'll have access to all features!`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🏠 Go to Dashboard', callback_data: 'start' }
                ]
            ]
        }
    };
    return { text: message, options };
}

// /start <wallet_address> [threshold] [duration]
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
        const { text: msgText, options } = getDashboardMessage();
        bot.sendMessage(chatId, msgText, options);
        return;
    }

    const walletAddress = args[0];

    if (!isValidAddress(walletAddress)) {
        bot.sendMessage(chatId, "❌ Invalid wallet address. Must start with '0x' and contain only hex characters.");
        return;
    }

    let threshold = 5.0; // Default 5%
    let duration = 300;  // Default 5 minutes

    if (args.length > 1) threshold = parseFloat(args[1]);
    if (args.length > 2) duration = parseInt(args[2]);

    if (isNaN(threshold) || isNaN(duration) || duration < 60) {
        bot.sendMessage(chatId, "❌ Invalid parameters.");
        return;
    }

    if (!subscribedUsers[chatId]) {
        subscribedUsers[chatId] = {
            wallets: { "Main": walletAddress },
            activeWallet: "Main",
            alertThreshold: threshold,
            alertDuration: duration,
            lastAlerts: {},
            priceAlerts: [],
            priceAlerts: [], // Typo fix: remove duplicate if exists elsewhere, but here it's fine
            pnlThreshold: null,
            lastPnlAlerts: {},
            trackedWallets: []
        };
    } else {
        // Update existing user
        const user = subscribedUsers[chatId];
        migrateUser(user);
        user.alertThreshold = threshold;
        user.alertDuration = duration;
        // If they provide a new wallet in /start, update "Main"
        user.wallets["Main"] = walletAddress;
        user.activeWallet = "Main";
    }

    const durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;
    const message = `✅ **Monitoring Started**\n\n` +
        `**Active Wallet (Main):** \`${walletAddress}\`\n` +
        `**Alert Threshold:** ${threshold}%\n` +
        `**Alert Duration:** ${durationText}`;

    const { options } = getDashboardMessage();
    bot.sendMessage(chatId, message, options);
});

// /addwallet <address> <name>
// /addwallet <address> <name>
bot.onText(/\/addwallet(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];
    const args = match[1] ? match[1].split(' ') : [];

    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }
    migrateUser(user);

    if (args.length < 2) {
        bot.sendMessage(chatId,
            "💡 **Command Help**\n\n" +
            "Usage: `/addwallet <address> <name>`\n" +
            "Example: `/addwallet 0x123... Main`\n\n" +
            "Please try again.",
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
                }
            }
        );
        return;
    }

    const address = args[0];
    const name = args[1];

    if (!isValidAddress(address)) {
        bot.sendMessage(chatId, "❌ Invalid address. Must start with '0x' and contain only hex characters.");
        return;
    }

    // Check for duplicate names (case-insensitive)
    const existingName = Object.keys(user.wallets).find(k => k.toLowerCase() === name.toLowerCase());
    if (existingName) {
        bot.sendMessage(chatId, `❌ Wallet name **${existingName}** already exists.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
            }
        });
        return;
    }

    user.wallets[name] = address;
    bot.sendMessage(chatId, `✅ Wallet **${name}** added!\nAddr: \`${address}\`\n\nUse the 👛 Wallets menu to make it active.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
        }
    });
});

// Helper for Tracking Message
function getTrackingMessage(user) {
    if (!user.trackedWallets || user.trackedWallets.length === 0) {
        return {
            text: "You are not tracking any wallets.",
            options: {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
                }
            }
        };
    }

    let message = "🕵️ **Tracked Wallets:**\n\n";
    user.trackedWallets.forEach((w, i) => {
        message += `${i + 1}. \`${w}\`\n`;
    });

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
        }
    };
    return { text: message, options };
}

// /tracking
bot.onText(/\/tracking/, (msg) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];
    if (!user) return;

    const { text, options } = getTrackingMessage(user);
    bot.sendMessage(chatId, text, options);
});

// /alert <symbol> <price>
// /alert <symbol> <price>
bot.onText(/\/alert(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];
    const args = match[1] ? match[1].split(' ') : [];

    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }

    if (args.length < 2) {
        bot.sendMessage(chatId,
            "💡 **Command Help**\n\n" +
            "Usage: `/alert <Symbol> <Price>`\n" +
            "Example: `/alert BTC 65000`\n\n" +
            "Please try again.",
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
                }
            }
        );
        return;
    }

    const symbol = args[0].toUpperCase();
    const targetPrice = parseFloat(args[1]);

    if (isNaN(targetPrice)) {
        bot.sendMessage(chatId, "❌ Invalid price.");
        return;
    }

    let loadingMsg;
    try {
        loadingMsg = await bot.sendMessage(chatId, `⏳ **Setting alert for ${symbol}...**`, { parse_mode: 'Markdown' });

        const markets = await decibel.getMarkets();
        // Fuzzy / Exact match
        // Try exact match first on name (e.g. "BTC-USD") or base (e.g. "BTC")
        let market = markets.find(m => m.market_name === symbol || m.market_name === `${symbol}-USD` || m.market_name === `${symbol}-PERP`);

        // If not found, try partial includes
        if (!market) {
            market = markets.find(m => m.market_name.includes(symbol));
        }

        if (!market) {
            if (loadingMsg) await bot.deleteMessage(chatId, loadingMsg.message_id);
            bot.sendMessage(chatId, `❌ Market **${symbol}** not found.`);
            return;
        }

        // Get current price to determine condition (above/below)
        const prices = await decibel.getMarketPrices();
        const priceInfo = prices.find(p => p.market === market.market_addr);
        if (!priceInfo) {
            if (loadingMsg) await bot.deleteMessage(chatId, loadingMsg.message_id);
            bot.sendMessage(chatId, `❌ Could not fetch price for **${market.market_name}**.`);
            return;
        }

        const currentPrice = parseFloat(priceInfo.mark_px);
        const condition = targetPrice > currentPrice ? 'above' : 'below';

        user.priceAlerts.push({
            marketAddr: market.market_addr,
            marketName: market.market_name,
            targetPrice: targetPrice,
            condition: condition,
            createdPrice: currentPrice
        });

        if (loadingMsg) await bot.deleteMessage(chatId, loadingMsg.message_id);

        const direction = condition === 'above' ? '📈 Rising to' : '📉 Falling to';
        bot.sendMessage(chatId, `✅ **Alert Set!**\n\n**${market.market_name}**\nCurrent: $${currentPrice}\nTarget: ${direction} $${targetPrice}`);

    } catch (e) {
        if (loadingMsg) try { await bot.deleteMessage(chatId, loadingMsg.message_id); } catch (err) { }
        console.error("Alert Set Error:", e);
        bot.sendMessage(chatId, "❌ Failed to set alert. API Error.");
    }
});
// Helper for Alerts Message
async function getAlertsMessage(user) {
    let message = `🔔 **Active Alerts**\n\n`;

    // Price Alerts
    if (user.priceAlerts.length === 0) {
        message += `**Price Targets:** None set.\n`;
    } else {
        message += `**Price Targets:**\n`;
        user.priceAlerts.forEach((alert, index) => {
            message += `${index + 1}. **${alert.marketName}** Target: $${alert.targetPrice}\n`;
        });
    }

    message += `\n──────────────────\n\n`;

    // Fetch Markets for suggestions
    let marketListText = "";
    try {
        const markets = await decibel.getMarkets();
        // Sort and take popular/all
        const marketNames = markets.map(m => m.market_name).sort();
        marketListText = `**Available Tokens:**\n\`${marketNames.join(', ')}\``;
    } catch (e) {
        marketListText = `**Available Tokens:** (Failed to fetch list)`;
    }

    message += marketListText + `\n\n` +
        `**💡 How to use:**\n` +
        `To set a price alert, use:\n` +
        `\`/alert <Symbol> <Price>\`\n\n` +
        `**Examples:**\n` +
        `• \`/alert BTC 65000\` (Alert when BTC hits $65k)\n` +
        `• \`/alert ETH 3500\` (Alert when ETH hits $3500)`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
        }
    };
    return { text: message, options };
}

// /alerts
bot.onText(/\/alerts/, async (msg) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];

    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }

    // Send loading state since we fetch markets now
    let loadingMsg;
    try {
        loadingMsg = await bot.sendMessage(chatId, "⏳ Fetching market data...", { parse_mode: 'Markdown' });
    } catch (e) { }

    const { text, options } = await getAlertsMessage(user);

    if (loadingMsg) {
        try { await bot.deleteMessage(chatId, loadingMsg.message_id); } catch (e) { }
    }

    bot.sendMessage(chatId, text, options);
});

// Helper for Wallets Message
function getWalletsMessage(user) {
    let message = "👛 **Your Wallets:**\nSelect a wallet to make it **Active** (view stats/alerts):";
    const keyboard = [];
    for (const [name, addr] of Object.entries(user.wallets)) {
        const isSelected = name === user.activeWallet;
        const check = isSelected ? "✅ " : "";
        keyboard.push([{
            text: `${check}${name} (${addr.slice(0, 6)}...${addr.slice(-4)})`,
            callback_data: `switch_${name}`
        }]);
    }
    // Add Back button
    keyboard.push([{ text: '🔙 Back to Menu', callback_data: 'start' }]);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    };
    return { text: message, options };
}

// /wallets
bot.onText(/\/wallets/, (msg) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];

    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }
    migrateUser(user);

    const { text, options } = getWalletsMessage(user);
    bot.sendMessage(chatId, text, options);
});

// /clear_alerts
bot.onText(/\/clear_alerts/, (msg) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];

    if (user) {
        user.priceAlerts = [];
        bot.sendMessage(chatId, "✅ All price target alerts cleared.");
    }
});

// /status
// Helper to generate Status Message
async function getStatusMessage(chatId, user) {
    const activeAddress = user.wallets[user.activeWallet];

    // Send temporary loading message only if triggered by command (optional, passed arg?)
    // For helper, we return the data. Loading state handling is complex in helper.
    // Let's assume the caller handles loading or we return a promise that resolves.

    const positions = await decibel.getPositions(activeAddress);

    if (!positions || positions.length === 0) {
        return {
            text: `📊 **[${user.activeWallet}]** No active positions found.`,
            options: {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
                }
            }
        };
    }

    let message = `📊 **Account Status (${user.activeWallet})**\n` +
        `**Wallet:** \`${activeAddress}\`\n\n` +
        `**Active Positions:**\n\n`;

    let totalPnl = 0;

    positions.forEach(pos => {
        totalPnl += pos.unrealizedPnl;

        let percentageDistance = 0;
        let dollarDistance = 0;

        if (pos.liquidationPrice > 0) {
            const priceDistance = Math.abs(pos.markPrice - pos.liquidationPrice);
            percentageDistance = (priceDistance / pos.liquidationPrice) * 100;
            dollarDistance = priceDistance * Math.abs(pos.size);
        }

        const statusEmoji = percentageDistance <= user.alertThreshold ? "🔴" : (percentageDistance <= user.alertThreshold * 2 ? "🟡" : "🟢");
        const pnlEmoji = pos.unrealizedPnl >= 0 ? "🟢" : "🔴";

        const side = pos.size > 0 ? "LONG" : "SHORT";
        const entryValue = Math.abs(pos.size * pos.entryPrice);
        const currentValue = Math.abs(pos.size * pos.markPrice);

        // Calculate PnL Percentage
        let pnlPercent = 0;
        if (entryValue > 0) {
            pnlPercent = (pos.unrealizedPnl / entryValue) * 100;
        }

        message += `${statusEmoji} **${pos.marketName}** (${side} ${pos.leverage}x)\n` +
            `   Size: ${Math.abs(pos.size).toFixed(2)}\n` +
            `   Entry Price: $${pos.entryPrice.toFixed(2)}\n` +
            `   Entry Value: $${entryValue.toFixed(2)}\n` +
            `   Current Price: $${pos.markPrice.toFixed(2)}\n` +
            `   Current Value: $${currentValue.toFixed(2)}\n` +
            `   Liquidation Price: $${pos.liquidationPrice.toFixed(2)}\n` +
            `   Distance to Liquidation: ${percentageDistance.toFixed(2)}% ($${dollarDistance.toFixed(2)})\n` +
            `   PnL: ${pnlEmoji} $${pos.unrealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pnlPercent.toFixed(2)}%)\n\n`;
    });

    const totalEmoji = totalPnl >= 0 ? "🟢" : "🔴";
    message += `**Total Unrealized PnL:** ${totalEmoji} $${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔄 Refresh', callback_data: 'status' },
                    { text: '🔙 Back to Menu', callback_data: 'start' }
                ]
            ]
        }
    };

    return { text: message, options };
}

// /status
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];

    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }
    migrateUser(user);

    let loadingMsg;
    try {
        loadingMsg = await bot.sendMessage(chatId, `⏳ **Fetching positions for ${user.activeWallet}...**`, { parse_mode: 'Markdown' });
    } catch (e) { }

    const { text, options } = await getStatusMessage(chatId, user);

    // Cleanup loading message
    if (loadingMsg) {
        try { await bot.deleteMessage(chatId, loadingMsg.message_id); } catch (e) { }
    }

    bot.sendMessage(chatId, text, options);
});

// Helper to generate Account Message
async function getAccountMessage(chatId, user) {
    const activeAddress = user.wallets[user.activeWallet];

    const overview = await decibel.getAccountOverview(activeAddress);
    const trades = await decibel.getTradeHistory(activeAddress);
    const positions = await decibel.getPositions(activeAddress);
    const markets = await decibel.getMarkets();
    const marketMap = new Map(markets.map(m => [m.market_addr, m.market_name]));

    if (!overview) {
        return { text: "❌ Unable to fetch account data.", options: { parse_mode: 'Markdown' } };
    }

    // Calculate Trade Stats
    let totalTrades = 0;
    let profitableTrades = 0;
    let losingTrades = 0;
    let totalRealizedPnl = 0;
    let totalVolumeUsd = 0;
    let largestWin = 0;
    let largestLoss = 0;
    let largestWinMarket = "";
    let largestLossMarket = "";

    if (trades) {
        totalTrades = trades.length;
        trades.forEach(trade => {
            const pnl = parseFloat(trade.realized_pnl_amount);
            const size = parseFloat(trade.size);
            const price = parseFloat(trade.price);
            const marketName = marketMap.get(trade.market) || "Unknown";

            totalRealizedPnl += pnl;
            totalVolumeUsd += Math.abs(size * price);

            if (pnl > 0) {
                profitableTrades++;
                if (pnl > largestWin) {
                    largestWin = pnl;
                    largestWinMarket = `(${marketName})`;
                }
            } else if (pnl < 0) {
                losingTrades++;
                if (pnl < largestLoss) {
                    largestLoss = pnl;
                    largestLossMarket = `(${marketName})`;
                }
            }
        });
    }

    const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;

    // Calculate Total Unrealized PnL
    let totalUnrealizedPnl = 0;
    if (positions) {
        positions.forEach(p => totalUnrealizedPnl += p.unrealizedPnl);
    }

    const message = `📊 **Account Overview (${user.activeWallet})**\n` +
        `**Wallet:** \`${activeAddress}\`\n\n` +
        `**📈 Trading Statistics:**\n` +
        `• Total Trades: ${totalTrades}\n` +
        `• All-Time Volume: $${totalVolumeUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
        `• Win Rate: ${winRate.toFixed(1)}%\n` +
        `• Profitable: ${profitableTrades}\n` +
        `• Losing: ${losingTrades}\n` +
        `• Largest Win: 🟢 +$${largestWin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${largestWinMarket}\n` +
        `• Largest Loss: 🔴 $${largestLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${largestLossMarket}\n\n` +
        `**💰 PnL Breakdown:**\n` +
        `• Realized PnL: ${totalRealizedPnl >= 0 ? "🟢" : "🔴"} $${totalRealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
        `• Unrealized PnL: ${totalUnrealizedPnl >= 0 ? "🟢" : "🔴"} $${totalUnrealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
        `**🏦 Portfolio Summary:**\n` +
        `• Equity: $${overview.perp_equity_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
        `• Margin Usage: ${(overview.cross_margin_ratio * 100).toFixed(2)}%\n` +
        `• Active Positions: ${positions ? positions.length : 0}`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔄 Refresh', callback_data: 'account' },
                    { text: '🔙 Back to Menu', callback_data: 'start' }
                ]
            ]
        }
    };

    return { text: message, options };
}

// /account
bot.onText(/\/account/, async (msg) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];

    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }
    migrateUser(user);

    let loadingMsg;
    try {
        loadingMsg = await bot.sendMessage(chatId, `⏳ **Fetching account data for ${user.activeWallet}...**`, { parse_mode: 'Markdown' });
    } catch (e) { }

    const { text, options } = await getAccountMessage(chatId, user);

    if (loadingMsg) {
        try { await bot.deleteMessage(chatId, loadingMsg.message_id); } catch (e) { }
    }

    bot.sendMessage(chatId, text, options);
});

// ... (settings, account, stop, help handlers remain mostly same, just update help text) ...

// Helper for Help Message


// Helper for Settings Message
function getSettingsMessage(user) {
    const threshold = user.alertThreshold;
    const duration = user.alertDuration;
    const durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;

    const message = `⚙️ **Settings**\n\n` +
        `**Active Wallet:** \`${user.wallets[user.activeWallet].slice(0, 6)}...${user.wallets[user.activeWallet].slice(-4)}\`\n` +
        `**Alert Threshold:** ${threshold}%\n` +
        `**Alert Interval:** ${durationText}\n\n` +
        `**ℹ️ What is Threshold?**\n` +
        `Alert triggers when price is within **X%** of liquidation.\n` +
        `(e.g. 5% = Danger zone starts 5% before liquidation)\n\n` +
        `Use the buttons below to adjust preferences.`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📉 Alert Threshold (% Drop)', callback_data: 'noop' }
                ],
                [
                    { text: '➖', callback_data: 'set_t_down' },
                    { text: `${threshold}%`, callback_data: 'noop' },
                    { text: '➕', callback_data: 'set_t_up' }
                ],
                [
                    { text: '⏱️ Alert Interval (Time)', callback_data: 'noop' }
                ],
                [
                    { text: '➖', callback_data: 'set_d_down' },
                    { text: `${Math.floor(duration / 60)}m`, callback_data: 'noop' },
                    { text: '➕', callback_data: 'set_d_up' }
                ],
                [
                    { text: '🔙 Back to Menu', callback_data: 'start' }
                ]
            ]
        }
    };
    return { text: message, options };
}

// /settings
bot.onText(/\/settings/, (msg) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];
    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }
    const { text, options } = getSettingsMessage(user);
    bot.sendMessage(chatId, text, options);
});

// /stop
bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    if (subscribedUsers[chatId]) {
        delete subscribedUsers[chatId];
        bot.sendMessage(chatId, "🛑 **Monitoring Stopped.**\nYou are no longer receiving alerts.\nUse `/start <wallet>` to resume monitoring.", { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, "⚠️ You are not currently being monitored.");
    }
});

// --- Monitoring Loop ---

// Global state for tracked wallets: { "0xWallet": { "marketAddr": { positionData } } }
const walletMonitorState = {};

// ... (previous handlers) ...

// /track <wallet_address>
bot.onText(/\/track(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];
    const args = match[1] ? match[1].split(' ') : [];
    const walletToTrack = args[0];

    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }

    if (!walletToTrack) {
        bot.sendMessage(chatId,
            "💡 **Command Help**\n\n" +
            "Usage: `/track <wallet_address>`\n" +
            "Example: `/track 0x123...abc`\n\n" +
            "Please try again.",
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
                }
            }
        );
        return;
    }

    if (!isValidAddress(walletToTrack)) {
        bot.sendMessage(chatId, "❌ Invalid wallet address. Must start with 0x and contain only hex characters.");
        return;
    }

    if (!user.trackedWallets) user.trackedWallets = [];

    if (user.trackedWallets.includes(walletToTrack)) {
        bot.sendMessage(chatId, "⚠️ You are already tracking this wallet.");
        return;
    }

    // Initial fetch to snapshot current positions (so we don't alert on existing ones)
    try {
        const positions = await decibel.getPositions(walletToTrack);

        if (!positions) {
            bot.sendMessage(chatId, "⚠️ Failed to fetch wallet data (API Error). Try again later.");
            return;
        }

        // Initialize or Refresh state for this wallet (Snapshot current positions)
        walletMonitorState[walletToTrack] = {};
        positions.forEach(pos => {
            walletMonitorState[walletToTrack][pos.marketAddr.toLowerCase()] = pos;
        });

        user.trackedWallets.push(walletToTrack);

        const backOption = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
            }
        };
        bot.sendMessage(chatId, `✅ **Tracking Wallet**\n\`${walletToTrack}\`\n\nI'll notify you when this wallet opens a **NEW** position.`, backOption);

    } catch (e) {
        bot.sendMessage(chatId, "❌ Failed to fetch wallet data. Check the address.");
    }
});

// /untrack <wallet_address>
// /untrack <wallet_address>
bot.onText(/\/untrack(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const user = subscribedUsers[chatId];
    const walletToUntrack = match[1] ? match[1].split(' ')[0] : null;

    if (!user) {
        const { text, options } = getOnboardingMessage();
        bot.sendMessage(chatId, text, options);
        return;
    }

    if (!walletToUntrack) {
        bot.sendMessage(chatId,
            "💡 **Command Help**\n\n" +
            "Usage: `/untrack <wallet_address>`\n" +
            "Example: `/untrack 0x123...abc`\n\n" +
            "Please try again.",
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
                }
            }
        );
        return;
    }

    if (!user || !user.trackedWallets) return;

    const index = user.trackedWallets.indexOf(walletToUntrack);
    if (index > -1) {
        user.trackedWallets.splice(index, 1);
        bot.sendMessage(chatId, `✅ Stopped tracking \`${walletToUntrack}\`.`);
    } else {
        bot.sendMessage(chatId, "❌ You are not tracking this wallet.");
    }
});



// ... (rest of handlers) ...

// --- Monitoring Loop ---

async function monitorPositions() {
    // 1. Fetch global market data (Prices & Metadata) ONCE per tick
    let marketPrices = [];
    let markets = [];
    try {
        [marketPrices, markets] = await Promise.all([
            decibel.getMarketPrices(),
            decibel.getMarkets()
        ]);
    } catch (e) {
        console.error("Failed to fetch global market data:", e);
    }

    const priceMap = new Map(marketPrices.map(p => [p.market, parseFloat(p.mark_px)]));

    // Collect all unique tracked wallets to avoid duplicate fetching
    const allTrackedWallets = new Set();
    Object.values(subscribedUsers).forEach(user => {
        if (user.trackedWallets) {
            user.trackedWallets.forEach(w => allTrackedWallets.add(w));
        }
    });

    // Monitor Tracked Wallets (New Positions)
    for (const walletAddr of allTrackedWallets) {
        try {
            // Pass cached markets and prices to avoid redundant API calls
            const currentPositions = await decibel.getPositions(walletAddr, markets, marketPrices);

            // Skip processing if API failed (returns null) to preserve state
            if (!currentPositions) {
                // console.warn(`Skipping update for ${walletAddr} due to API failure.`);
                continue;
            }

            const knownPositions = walletMonitorState[walletAddr] || {};
            const currentPositionMap = {}; // To update state later

            if (currentPositions) {
                for (const pos of currentPositions) {
                    const marketKey = pos.marketAddr.toLowerCase();
                    currentPositionMap[marketKey] = pos;

                    // CHECK FOR NEW POSITIONS
                    if (!knownPositions[marketKey]) {
                        // New position detected!
                        // Notify all users tracking this wallet
                        for (const [chatId, user] of Object.entries(subscribedUsers)) {
                            if (user.trackedWallets && user.trackedWallets.includes(walletAddr)) {
                                const side = pos.size > 0 ? "LONG" : "SHORT";
                                const message = `🚨 **NEW POSITION DETECTED** 🚨\n\n` +
                                    `**Wallet:** \`${walletAddr}\`\n` +
                                    `**Market:** ${pos.marketName}\n` +
                                    `**Side:** ${side} ${pos.leverage}x\n` +
                                    `**Entry:** $${pos.entryPrice.toFixed(2)}\n` +
                                    `**Size:** ${Math.abs(pos.size).toFixed(2)}`;

                                const backOption = {
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'start' }]]
                                    }
                                };
                                bot.sendMessage(chatId, message, backOption);
                            }
                        }
                    }
                }
            }
            // Update state
            walletMonitorState[walletAddr] = currentPositionMap;
            // console.log(`[Monitor] Updated state for ${walletAddr}. Positions: ${Object.keys(currentPositionMap).length}`);

        } catch (e) {
            console.error(`Error monitoring tracked wallet ${walletAddr}:`, e);
        }
    }

    for (const [chatId, user] of Object.entries(subscribedUsers)) {
        try {
            // --- Check Price Alerts ---
            // ... (existing price alert code) ...

            if (user.priceAlerts && user.priceAlerts.length > 0) {
                const triggeredIndexes = [];
                user.priceAlerts.forEach((alert, index) => {
                    const currentPrice = priceMap.get(alert.marketAddr);
                    if (currentPrice) {
                        let triggered = false;
                        if (alert.condition === 'above' && currentPrice >= alert.targetPrice) triggered = true;
                        if (alert.condition === 'below' && currentPrice <= alert.targetPrice) triggered = true;

                        if (triggered) {
                            bot.sendMessage(chatId, `🔔 **PRICE ALERT** 🔔\n\n**${alert.marketName}** hit **$${alert.targetPrice}**!\nCurrent Price: $${currentPrice}`, { parse_mode: 'Markdown' });
                            triggeredIndexes.push(index);
                        }
                    }
                });

                // Remove triggered alerts (reverse order to not mess up indexes)
                for (let i = triggeredIndexes.length - 1; i >= 0; i--) {
                    user.priceAlerts.splice(triggeredIndexes[i], 1);
                }
            }

            // --- Check Positions (Liquidation & PnL) ---
            // Iterate through ALL wallets to ensure safety
            migrateUser(user);
            const userWallets = Object.values(user.wallets);

            for (const walletAddr of userWallets) {
                let positions;
                try {
                    // Reuse cached market data passed to getPositions (handled internally or we pass it if supported)
                    // Note: Here we call getPositions(walletAddr). It might be better to pass markets/prices if we updated getPositions to use them.
                    // For now, let's just call it. Optimized version uses cache if passed.
                    // Actually, earlier we updated getPositions to take (addr, markets, prices).
                    // We should pass them here too for consistency!
                    positions = await decibel.getPositions(walletAddr, markets, marketPrices);
                } catch (e) {
                    console.error(`Error fetching positions for ${walletAddr}:`, e);
                    continue;
                }

                if (!positions) continue;

                for (const pos of positions) {
                    // Liquidation Check
                    if (pos.liquidationPrice > 0) {
                        const priceDistance = Math.abs(pos.markPrice - pos.liquidationPrice);
                        const percentageDistance = (priceDistance / pos.liquidationPrice) * 100;

                        if (percentageDistance <= user.alertThreshold) {
                            const alertKey = `${chatId}_${walletAddr}_${pos.marketName}_liq`; // Key needs walletAddr now
                            const currentTime = Date.now();
                            const lastAlertTime = user.lastAlerts[alertKey] || 0;

                            if (currentTime - lastAlertTime > user.alertDuration * 1000) {
                                const entryValue = pos.entryPrice * pos.size;
                                const currentValue = pos.markPrice * pos.size;
                                const side = pos.size > 0 ? "LONG" : "SHORT";
                                const dollarDistance = priceDistance * Math.abs(pos.size);

                                const message = `🚨 **LIQUIDATION ALERT** 🚨\n\n` +
                                    `**Wallet:** \`${walletAddr}\`\n` +
                                    `**Position:** ${pos.marketName}\n` +
                                    `**Side:** ${side}\n` +
                                    `**Size:** ${Math.abs(pos.size).toFixed(2)}\n` +
                                    `**Entry Price:** $${pos.entryPrice.toFixed(2)}\n` +
                                    `**Entry Value:** $${entryValue.toFixed(2)}\n` +
                                    `**Current Price:** $${pos.markPrice.toFixed(2)}\n` +
                                    `**Current Value:** $${currentValue.toFixed(2)}\n` +
                                    `**Liquidation Price:** $${pos.liquidationPrice.toFixed(2)}\n` +
                                    `**Distance to Liquidation:** ${percentageDistance.toFixed(2)}% ($${dollarDistance.toFixed(2)})\n\n` +
                                    `**Action Required:** Consider closing position or adding margin!`;

                                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                                user.lastAlerts[alertKey] = currentTime;
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error monitoring user ${chatId}:`, error);
        }
    }
}

// Run monitoring every 1 second (High Performance & Safe for ~5 wallets)
setInterval(monitorPositions, 30000);
