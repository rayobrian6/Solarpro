#!/usr/bin/env python3
"""
Use Playwright to connect to the existing browser, set the auth cookie,
and navigate to the Design Studio.
"""
import subprocess
import sys

# The session token from our login
SESSION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImE2YjYwNzEzLThlZmEtNGQ5ZS1hZWU5LWI1MWQxMWYzOTI0OCIsIm5hbWUiOiJSYXkgQnJpYW4iLCJlbWFpbCI6InJheW9icmlhbjZAZ21haWwuY29tIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3NzMwMjIyMDUsImV4cCI6MTc3NTYxNDIwNX0.OhGI_1FkQXzFkEB3EY-rJLDZbsFSdDQA4HMsvUf6Q7Q"
PROJECT_ID = "e1d55f58-8371-4608-ba76-fb9ac5398171"

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    # Launch a new browser instance
    browser = p.chromium.launch(headless=False)
    context = browser.new_context()
    
    # Set the auth cookie
    context.add_cookies([{
        'name': 'solarpro_session',
        'value': SESSION_TOKEN,
        'domain': 'solarpro-v31.vercel.app',
        'path': '/',
        'httpOnly': True,
        'secure': True,
        'sameSite': 'Lax'
    }])
    
    page = context.new_page()
    url = f"https://solarpro-v31.vercel.app/design?projectId={PROJECT_ID}"
    print(f"Navigating to: {url}")
    page.goto(url, timeout=30000)
    print(f"Current URL: {page.url}")
    print(f"Title: {page.title()}")
    
    # Wait for design studio to load
    page.wait_for_timeout(5000)
    print("Page loaded")
    
    browser.close()