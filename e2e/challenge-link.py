"""Exercise a shared challenge link against a running web build.

Python Playwright + Chromium are required. Accepts URL as the first argument.

Beyond the first open, this checks that a link is acted on once per attempt:
the hash leaves the address bar, a reload brings the half-played challenge back
as it was rather than starting it again over the saved board, leaving for free
play and reloading keeps the challenge saved, the same link opened again
resumes that attempt, and a different link still opens its own challenge.
"""
import json
import os
import re
import sys
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5174/'
CHALLENGE_KEY = 'sudokuoku:challenge:v1'
FREE_KEY = 'sudokuoku:game:v1'
PROFILE_KEY = 'sudokuoku:profile:v1'
VIEWPORT = {'width': 390, 'height': 844}
CELL = re.compile(r'^Row \d, column \d, ')
CHALLENGE_TITLE = re.compile('^Challenge · ')
FREE_TITLE = re.compile(' · shifting board$')


def saved(page, key=CHALLENGE_KEY):
    raw = page.evaluate(f'localStorage.getItem({json.dumps(key)})')
    return json.loads(raw) if raw else None


def board(page):
    """The board as a screen reader hears it: one label per cell, in grid order."""
    labels = page.evaluate(
        'Array.from(document.querySelectorAll(\'[role="button"][aria-label^="Row "]\'))'
        '.map(e => e.getAttribute("aria-label"))'
    )
    cells = [label for label in labels if CELL.match(label)]
    assert len(cells) == 81, f'expected 81 cells, saw {len(cells)}'
    return cells


def close_help(page):
    close = page.get_by_role('button', name='Close', exact=True)
    if close.count():
        close.first.click()
        expect(close).to_have_count(0)


def share_link(page):
    page.evaluate('window.sharedChallengeText = undefined')
    page.get_by_role('button', name='Challenge a friend', exact=True).click()
    page.get_by_role('button', name='Send challenge', exact=True).click()
    page.wait_for_function('typeof window.sharedChallengeText === "string"')
    shared = page.evaluate('window.sharedChallengeText')
    link = next(line for line in shared.splitlines() if line.startswith(('http://', 'https://')))
    page.get_by_role('button', name='Close', exact=True).click()
    expect(page.get_by_role('button', name='Close', exact=True)).to_have_count(0)
    return shared, link


def undo_enabled(page):
    return page.get_by_role('button', name='Undo', exact=True).get_attribute('aria-disabled') != 'true'


def play_stats(page):
    return saved(page, PROFILE_KEY)['stats']


def expect_hash_consumed(page):
    """The link has been acted on, so the code must leave the address bar."""
    page.wait_for_function('!location.hash.startsWith("#/c/")')
    assert '#/c/' not in page.url, 'consumed challenge hash still in the address bar: ' + page.url


def expect_resumed(page, before, played_board):
    """The half-played challenge is on screen exactly as it was left."""
    expect(page.get_by_text(CHALLENGE_TITLE)).to_be_visible()
    page.get_by_role('button', name=re.compile(r'^Row 1, column 1, ')).wait_for()
    # Give a wrongly re-opened link time to overwrite the save before checking it.
    page.wait_for_timeout(2500)
    after = saved(page)
    assert after['moves'] == before['moves'] == 1, f'saved move count changed: {before["moves"]} -> {after["moves"]}'
    assert after['values'] == before['values'], 'saved board changed'
    assert after['seed'] == before['seed'], 'saved challenge changed'
    assert board(page) == played_board, 'board on screen is not the one left behind'
    assert undo_enabled(page), 'Undo must still be enabled'
    assert '#/c/' not in page.url, 'challenge hash is back in the address bar: ' + page.url


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('PW_CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport=VIEWPORT)
    context.add_init_script('navigator.share = async data => { window.sharedChallengeText = data.text; };')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url, wait_until='networkidle', timeout=120000)
    page.get_by_role('button', name='Close', exact=True).click()
    expect(page.get_by_role('button', name='Close', exact=True)).to_have_count(0)
    shared, link = share_link(page)
    assert urlsplit(link).netloc == urlsplit(url).netloc, 'shared link must use the running app host: ' + link
    assert urlsplit(link).path == urlsplit(url).path, 'shared link must retain the repository path'
    assert urlsplit(link).fragment.startswith('/c/'), 'challenge belongs in the hash, so a static host serves the app'
    code = urlsplit(link).fragment[3:]
    assert code and shared.endswith(code), 'share must also include the plain code fallback'

    # First open of the link.
    recipient = browser.new_context(viewport=VIEWPORT)
    received = recipient.new_page()
    received.on('pageerror', lambda error: errors.append(str(error)))
    response = received.goto(link, wait_until='networkidle', timeout=120000)
    assert response.status == 200, 'shared link must open the static app'
    received.get_by_role('button', name='Close', exact=True).click()
    expect(received.get_by_role('button', name='Close', exact=True)).to_have_count(0)
    expect(received.get_by_text(CHALLENGE_TITLE)).to_be_visible()
    received.get_by_role('button', name='Challenge a friend', exact=True).click()
    expect(received.get_by_text('You are playing a challenge', exact=True)).to_be_visible()
    received.get_by_role('button', name='Close', exact=True).click()
    expect(received.get_by_role('button', name='Close', exact=True)).to_have_count(0)
    expect_hash_consumed(received)
    received.wait_for_function(f'localStorage.getItem({json.dumps(CHALLENGE_KEY)}) !== null')
    opened = saved(received)
    assert opened['moves'] == 0 and opened['status'] == 'playing', opened
    stats = play_stats(received)

    # One move, then a reload: the half-played challenge must come back as it was.
    fresh_board = board(received)
    empty = received.get_by_role('button', name=re.compile(r'^Row \d, column \d, empty$')).first
    row, col = map(int, re.match(r'Row (\d), column (\d)', empty.get_attribute('aria-label')).groups())
    digit = opened['solution'][(row - 1) * 9 + (col - 1)]
    empty.click()
    received.get_by_role('button', name=f'Enter {digit}', exact=True).click()
    received.wait_for_function(f'JSON.parse(localStorage.getItem({json.dumps(CHALLENGE_KEY)})).moves === 1')
    played_board = board(received)
    assert played_board != fresh_board, 'the move must show on the board'
    assert undo_enabled(received), 'Undo must be enabled after a move'
    before = saved(received)

    received.reload(wait_until='networkidle', timeout=120000)
    close_help(received)
    expect_resumed(received, before, played_board)
    assert play_stats(received) == stats, 'reload counted another play'

    # Leaving for free play keeps the challenge saved, and a reload then shows free play.
    received.get_by_role('button', name='New game', exact=True).click()
    expect(received.get_by_text(FREE_TITLE)).to_be_visible()
    received.wait_for_function(f'JSON.parse(localStorage.getItem({json.dumps(FREE_KEY)})).moves === 0')
    received.reload(wait_until='networkidle', timeout=120000)
    close_help(received)
    expect(received.get_by_text(FREE_TITLE)).to_be_visible()
    received.wait_for_timeout(1500)
    parked = saved(received)
    assert parked['moves'] == 1 and parked['values'] == before['values'], 'leaving the challenge lost its progress'
    stats = play_stats(received)  # the new free game counted a play; nothing after this may

    # The same link opened again resumes that attempt instead of restarting it.
    again = recipient.new_page()
    again.on('pageerror', lambda error: errors.append(str(error)))
    again.goto(link, wait_until='networkidle', timeout=120000)
    close_help(again)
    expect_hash_consumed(again)
    expect_resumed(again, before, played_board)
    assert play_stats(again) == stats, 'reopening the link counted another play'

    # A different link afterwards still starts that other challenge.
    sender_seed = saved(page, FREE_KEY)['seed']
    page.get_by_role('button', name='New game', exact=True).click()
    page.wait_for_function(f'JSON.parse(localStorage.getItem({json.dumps(FREE_KEY)})).seed !== {sender_seed}')
    other_shared, other_link = share_link(page)
    assert other_link != link, 'a new game must give a new link'
    other = recipient.new_page()
    other.on('pageerror', lambda error: errors.append(str(error)))
    other.goto(other_link, wait_until='networkidle', timeout=120000)
    close_help(other)
    expect(other.get_by_text(CHALLENGE_TITLE)).to_be_visible()
    other.wait_for_function(f'JSON.parse(localStorage.getItem({json.dumps(CHALLENGE_KEY)})).seed !== {before["seed"]}')
    opened_other = saved(other)
    assert opened_other['moves'] == 0 and opened_other['status'] == 'playing', opened_other
    expect_hash_consumed(other)

    assert not errors, '\n'.join(errors)
    browser.close()
print('PASS: shared link retains host/path, includes plain code, opens a challenge once, survives reloads, resumes when reopened, and a second link opens its own challenge')
