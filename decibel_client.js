require('dotenv').config();
const { DecibelReadDex, TESTNET_CONFIG } = require("@decibeltrade/sdk");

const apiKey = process.env.DECIBEL_API_KEY;

const read = new DecibelReadDex(TESTNET_CONFIG, {
    nodeApiKey: apiKey,
    onWsError: (error) => console.error("WebSocket error:", error),
});

async function getAccountOverview(userAddr) {
    try {
        const overview = await read.accountOverview.getByAddr(userAddr);
        return overview;
    } catch (error) {
        console.error("Error fetching account overview:", error);
        return null;
    }
}

async function getPositions(userAddr, cachedMarkets = null, cachedPrices = null) {
    try {
        // 1. Fetch market metadata (or use cache)
        let markets = cachedMarkets;
        if (!markets) {
            markets = await read.markets.getAll();
        }
        const marketMap = new Map(markets.map(m => [m.market_addr, m.market_name]));

        // 2. Fetch market prices (or use cache)
        let prices = cachedPrices;
        if (!prices) {
            prices = await read.marketPrices.getAll();
        }
        const priceMap = new Map(prices.map(p => [p.market, p.mark_px]));

        // 3. Fetch user positions
        const positions = await read.userPositions.getByAddr({ subAddr: userAddr });

        // 4. Enrich positions
        return positions.map(pos => {
            const marketName = marketMap.get(pos.market) || "Unknown Market";
            const markPrice = priceMap.get(pos.market) || 0;
            const pnl = (markPrice - pos.entry_price) * pos.size;

            // Calculate liquidation price if not provided (though SDK seems to provide it)
            // Using the one from SDK: estimated_liquidation_price

            return {
                marketName,
                marketAddr: pos.market,
                size: pos.size,
                entryPrice: pos.entry_price,
                markPrice,
                leverage: pos.user_leverage,
                liquidationPrice: pos.estimated_liquidation_price,
                unrealizedPnl: pnl,
                unrealizedFunding: pos.unrealized_funding,
                isIsolated: pos.is_isolated
            };
        });

    } catch (error) {
        if (error.message && (error.message.includes('429') || error.message.includes('Too Many Requests'))) {
            const now = new Date().toISOString().split('T')[1].split('.')[0];
            console.warn(`[${now}] ⚠️ Rate Limit Hit (429). Skipping update.`);
        } else {
            console.error("Error fetching positions:", error);
        }
        return null;
    }
}

async function getTradeHistory(userAddr) {
    try {
        // Direct fetch to bypass SDK Zod validation error
        const url = `https://api.testnet.aptoslabs.com/decibel/api/v1/trade_history?user=${userAddr}&limit=1000`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // If data is an array, return it
        if (Array.isArray(data)) {
            return data;
        }

        // If data is an object with a 'data' property (common pagination pattern)
        if (data && Array.isArray(data.data)) {
            return data.data;
        }

        if (data && data.status === 'failed') {
            console.warn(`Trade history API failed: ${data.message}. Falling back to Order History.`);

            // Fallback: Use Order History to at least get Volume and Trade Count
            try {
                const orders = await read.userOrderHistory.getByAddr(userAddr);
                // Note: The SDK seems to return 'items' or 'data' depending on context/version.
                // We handle both.
                const ordersList = orders.items || orders.data || [];

                if (Array.isArray(ordersList)) {
                    // Filter for filled orders
                    const filledOrders = ordersList.filter(o => o.status === 'Filled' || o.status === 'filled');

                    // Map to trade format (PnL will be 0 as it's not available in orders)
                    return filledOrders.map(o => ({
                        size: o.orig_size,
                        price: o.price,
                        realized_pnl_amount: 0, // Not available in order history
                        side: o.order_direction,
                        market: o.market
                    }));
                }
            } catch (fallbackError) {
                console.error("Fallback to order history failed:", fallbackError);
            }

            return [];
        }

        console.error("Unexpected trade history response format:", data);
        return [];
    } catch (error) {
        console.error("Error fetching trade history (direct):", error);
        return [];
    }
}

async function getMarkets() {
    try {
        const markets = await read.markets.getAll();
        return markets;
    } catch (error) {
        console.error("Error fetching markets:", error);
        return [];
    }
}

async function getMarketPrices() {
    try {
        const prices = await read.marketPrices.getAll();
        return prices;
    } catch (error) {
        if (error.message && (error.message.includes('429') || error.message.includes('Too Many Requests'))) {
            // console.warn("429 in getMarketPrices (Skipping)"); // Optional: suppress completely or verify log volume
            // Just return empty, main loop handles rest
        } else {
            console.error("Error fetching market prices:", error);
        }
        return [];
    }
}

async function getLeaderboard(searchTerm) {
    try {
        const result = await read.leaderboard.getLeaderboard({
            q: searchTerm,
            limit: 10,
            sort_by: "realized_pnl", // You might want to parameterize this or default to realized PnL
            sort_order: "desc"
        });
        return result;
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        return null;
    }
}

module.exports = {
    getAccountOverview,
    getPositions,
    getTradeHistory,
    getMarkets,
    getMarketPrices,
    getLeaderboard
};
