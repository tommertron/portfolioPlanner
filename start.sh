#!/bin/bash

# Portfolio Planner - Startup Script
# This script checks dependencies and starts the web server

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "======================================================================"
echo "  Portfolio Planner - Starting Up"
echo "======================================================================"
echo ""

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 not found. Please install Python 3."
    exit 1
fi

echo -e "${BLUE}✓${NC} Python 3 found: $(python3 --version)"
echo ""

# Check and install requirements
echo -e "${BLUE}Checking dependencies...${NC}"
if [ -f "requirements.txt" ]; then
    echo -e "${YELLOW}Installing/updating packages from requirements.txt...${NC}"
    python3 -m pip install -q -r requirements.txt
    echo -e "${GREEN}✓${NC} Dependencies installed"
else
    echo "❌ Error: requirements.txt not found"
    exit 1
fi

echo ""
echo "======================================================================"
echo -e "  ${GREEN}Starting Portfolio Planner Web Server${NC}"
echo "======================================================================"
echo ""
echo "  🌐 Open your browser to: http://localhost:5959"
echo ""
echo "  Press Ctrl+C to stop the server"
echo ""
echo "======================================================================"
echo ""

# Start the web app
python3 run_webapp.py
