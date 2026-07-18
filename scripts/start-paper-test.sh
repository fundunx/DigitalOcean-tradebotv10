#!/usr/bin/env bash
set -e

cd /var/www/apexquant-v10

mkdir -p logs data

if [ ! -s data/valid-symbols.txt ]; then
  echo "data/valid-symbols.txt missing. Refusing to start without validated symbols."
  exit 1
fi

export FEED_SYMBOLS="$(cat data/valid-symbols.txt)"

export MODE=paper
export LIVE_TRADING_LOCKED=true
export PORT=3000
export DATA_DIR=data

export PAPER_EXECUTION_ENABLED=true
export PAPER_TEST_MODE=true
export PAPER_EXECUTION_INTERVAL_MS=60000
export PAPER_MAX_TRADE_AGE_MS=1800000
export PAPER_MIN_CONFIDENCE=55
export PAPER_MIN_SIGNALS=1
export PAPER_FIXED_TRADE_SIZE_GBP=2000

export PAPER_SCALP_POT_GBP=10000
export PAPER_STRATEGY_POT_GBP=10000
export PAPER_MAX_SCALP_TRADES=5
export PAPER_MAX_STRATEGY_TRADES=5

export TRADE_SIZE_GBP=2000
export MIN_TRADE_SIZE_GBP=2000
export MAX_OPEN_TRADES_PER_POT=5
export BOOTSTRAP_HISTORICAL_CANDLES=false

echo "Starting ApexQuant paper test..."
echo "Symbols: $(echo "$FEED_SYMBOLS" | tr ',' '\n' | wc -l)"
echo "Mode: $MODE"
echo "Live locked: $LIVE_TRADING_LOCKED"
echo "Scalp pot: £$PAPER_SCALP_POT_GBP max $PAPER_MAX_SCALP_TRADES trades"
echo "Strategy pot: £$PAPER_STRATEGY_POT_GBP max $PAPER_MAX_STRATEGY_TRADES trades"

nohup npm start > logs/apexquant-v10.log 2>&1 &
echo $! > data/apexquant.pid

echo "Started PID $(cat data/apexquant.pid)"
