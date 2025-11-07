#!/usr/bin/env python3
"""
WSGI entry point for production deployment with Gunicorn.
"""

from webapp.app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5959)
