#!/usr/bin/env python3
"""
Start the Portfolio Planner web application.
"""

from webapp.app import create_app

if __name__ == "__main__":
    app = create_app()
    print("\n" + "="*60)
    print("  Portfolio Planner Web App")
    print("="*60)
    print("\n  Open your browser to: http://localhost:5959")
    print("\n  Press Ctrl+C to stop the server\n")
    print("="*60 + "\n")
    app.run(host="0.0.0.0", port=5959, debug=True)
