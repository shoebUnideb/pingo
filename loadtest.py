"""
Pingo load test — simulates N concurrent players on the live server.
Usage:  python3 loadtest.py
Requires:  pip install "python-socketio[client]" gevent gevent-websocket
"""

import gevent
from gevent import monkey
monkey.patch_all()

import socketio
import time
import random
import statistics

TARGET = "https://pingo-j2d3.onrender.com"   # ← your Render URL
GAME_CODE = input("Enter the game code shown on the host screen: ").strip()
NUM_PLAYERS = 40
RESULTS = []   # (player_id, latency_ms, event)
ERRORS   = []

def simulate_player(player_id):
    name = f"TestUser{player_id:02d}"
    sio  = socketio.Client(reconnection=False, logger=False, engineio_logger=False)

    connected_at    = None
    question_count  = 0

    @sio.event
    def connect():
        nonlocal connected_at
        connected_at = time.time()
        sio.emit('join_as_player', { 'code': GAME_CODE, 'name': name })
        RESULTS.append((name, 0, 'connected'))

    @sio.on('waiting')
    def on_waiting(data):
        pass  # lobby — wait for game start

    @sio.on('question_data')
    def on_question(data):
        nonlocal question_count
        question_count += 1
        t0 = time.time()
        # Random think time 1–8 seconds (realistic)
        gevent.sleep(random.uniform(1, 8))
        answer_idx = random.randint(0, len(data.get('options', ['a','b','c','d'])) - 1)
        sio.emit('submit_answer', {'answer_index': answer_idx})
        latency = round((time.time() - t0) * 1000)
        RESULTS.append((name, latency, f'answered_q{question_count}'))

    @sio.on('collect_feedback')
    def on_feedback(*args):
        gevent.sleep(random.uniform(1, 3))
        sio.emit('submit_feedback', {
            'rating': random.randint(3, 5),
            'comment': 'Load test',
            'contact': ''
        })

    @sio.on('game_over')
    def on_gameover(data):
        RESULTS.append((name, 0, 'game_over_received'))
        sio.disconnect()

    @sio.on('game_reset')
    def on_reset(data):
        sio.disconnect()

    @sio.event
    def connect_error(data):
        ERRORS.append((name, str(data)))

    try:
        sio.connect(TARGET, transports=['polling', 'websocket'])
        # Stay connected up to 5 minutes waiting for host to run quiz
        sio.wait()
    except Exception as e:
        ERRORS.append((name, str(e)))


def run():
    print(f"\n{'='*55}")
    print(f"  Pingo Load Test — {NUM_PLAYERS} simulated players")
    print(f"  Target: {TARGET}")
    print(f"{'='*55}")
    print(f"\n  Connecting all {NUM_PLAYERS} players...")
    print(f"  → Open {TARGET}/host and start the quiz NOW\n")

    start = time.time()
    greenlets = []
    for i in range(NUM_PLAYERS):
        greenlets.append(gevent.spawn(simulate_player, i+1))
        gevent.sleep(0.1)   # 100ms stagger between each connection

    # Print live connection count every 5s
    def monitor():
        while any(not g.dead for g in greenlets):
            connected = sum(1 for r in RESULTS if r[2] == 'connected')
            finished  = sum(1 for r in RESULTS if r[2] == 'game_over_received')
            print(f"  [{int(time.time()-start):>3}s]  Connected: {connected}/{NUM_PLAYERS}  |  Finished: {finished}  |  Errors: {len(ERRORS)}")
            gevent.sleep(5)

    gevent.spawn(monitor)
    gevent.joinall(greenlets, timeout=300)

    # ── Summary ──────────────────────────────────────────────
    total        = time.time() - start
    connected    = sum(1 for r in RESULTS if r[2] == 'connected')
    finished     = sum(1 for r in RESULTS if r[2] == 'game_over_received')
    answer_times = [r[1] for r in RESULTS if r[2].startswith('answered')]

    print(f"\n{'='*55}")
    print(f"  RESULTS after {total:.1f}s")
    print(f"{'='*55}")
    print(f"  Players connected : {connected} / {NUM_PLAYERS}")
    print(f"  Game over received: {finished} / {NUM_PLAYERS}")
    print(f"  Errors            : {len(ERRORS)}")
    if answer_times:
        print(f"  Answer submit times (think time included):")
        print(f"    min  {min(answer_times)} ms")
        print(f"    max  {max(answer_times)} ms")
        print(f"    avg  {round(statistics.mean(answer_times))} ms")
    if ERRORS:
        print(f"\n  Error details:")
        for e in ERRORS[:10]:
            print(f"    {e[0]}: {e[1]}")
    print(f"{'='*55}\n")


if __name__ == '__main__':
    run()
