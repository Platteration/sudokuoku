"""Exercise a shared challenge link against a running web build.

Python Playwright + Chromium are required. Accepts URL as the first argument.
"""
import os
import re
import sys
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5174/'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('PW_CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    context.add_init_script('navigator.share = async data => { window.sharedChallengeText = data.text; };')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url, wait_until='networkidle', timeout=120000)
    page.get_by_role('button', name='Close', exact=True).click()
    expect(page.get_by_role('button', name='Close', exact=True)).to_have_count(0)
    page.get_by_role('button', name='Challenge a friend', exact=True).click()
    page.get_by_role('button', name='Send challenge', exact=True).click()
    page.wait_for_function('typeof window.sharedChallengeText === "string"')
    shared = page.evaluate('window.sharedChallengeText')
    link = next(line for line in shared.splitlines() if line.startswith(('http://', 'https://')))
    assert urlsplit(link).netloc == urlsplit(url).netloc, 'shared link must use the running app host: ' + link
    assert urlsplit(link).path == urlsplit(url).path, 'shared link must retain the repository path'
    assert urlsplit(link).fragment.startswith('/c/'), 'challenge belongs in the hash, so a static host serves the app'
    code = urlsplit(link).fragment[3:]
    assert code and shared.endswith(code), 'share must also include the plain code fallback'
    recipient = browser.new_context(viewport={'width': 390, 'height': 844})
    received = recipient.new_page()
    received.on('pageerror', lambda error: errors.append(str(error)))
    response = received.goto(link, wait_until='networkidle', timeout=120000)
    assert response.status == 200, 'shared link must open the static app'
    received.get_by_role('button', name='Close', exact=True).click()
    expect(received.get_by_role('button', name='Close', exact=True)).to_have_count(0)
    expect(received.get_by_text(re.compile('^Challenge · '))).to_be_visible()
    received.get_by_role('button', name='Challenge a friend', exact=True).click()
    expect(received.get_by_text('You are playing a challenge', exact=True)).to_be_visible()
    assert not errors, '\n'.join(errors)
    browser.close()
print('PASS: shared link retains host/path, includes plain code and opens a fresh challenge')
