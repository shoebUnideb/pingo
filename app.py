import json
import os
import random

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins='*')

# ── Load questions ───────────────────────────────────────────────────────────
with open('questions.json') as f:
    QUESTIONS = json.load(f)

# ── Game state (in-memory, resets on server restart) ─────────────────────────
def generate_code():
    return str(random.randint(100000, 999999))

state = {
    'started': False,
    'current_index': -1,      # -1 = lobby / not started
    'host_sid': None,
    'game_code': generate_code(),  # 6-digit join code
    'players': {},             # sid → name
    'answers': {},             # sid → option index (for current question)
    'answer_counts': [0, 0, 0, 0],
    'answer_details': [],      # list of {name, answer_index} for dashboard
    'question_stats': [],      # list of per-question snapshots for end summary
    'feedback_data': [],       # list of {name, rating, comment, contact}
    'feedback_phase': False,   # True when collecting feedback
}


def snapshot_current_question():
    """Save current question's stats before moving on."""
    idx = state['current_index']
    if idx < 0 or idx >= len(QUESTIONS):
        return
    q = QUESTIONS[idx]
    # Build per-player response list
    player_responses = [
        {'name': state['players'][sid], 'answer_index': ans_idx}
        for sid, ans_idx in state['answers'].items()
        if sid in state['players']
    ]
    state['question_stats'].append({
        'question': q['question'],
        'options': q['options'],
        'counts': list(state['answer_counts']),
        'attempted': len(state['answers']),
        'total_players': len(state['players']),
        'player_responses': player_responses,
    })


def reset_answers():
    state['answers'] = {}
    state['answer_counts'] = [0, 0, 0, 0]
    state['answer_details'] = []


def current_question_payload():
    idx = state['current_index']
    q = QUESTIONS[idx]
    return {
        'question': q['question'],
        'options': q['options'],
        'index': idx,
        'total': len(QUESTIONS),
    }


# ── HTTP routes ───────────────────────────────────────────────────────────────
@app.route('/host')
def host_page():
    return render_template('host.html')


@app.route('/player')
def player_page():
    return render_template('player.html')


@app.route('/')
def index():
    return (
        '<h2>Pingo</h2>'
        '<p><a href="/host">Host view</a></p>'
        '<p><a href="/player">Player view</a></p>'
    )


# ── Socket events: HOST ───────────────────────────────────────────────────────
@socketio.on('join_as_host')
def on_join_as_host():
    state['host_sid'] = request.sid
    join_room('host_room')
    emit('host_ack', {
        'player_count': len(state['players']),
        'started': state['started'],
        'question_count': len(QUESTIONS),
        'game_code': state['game_code'],
    })


@socketio.on('start_game')
def on_start_game():
    if request.sid != state['host_sid']:
        return
    if state['started']:
        return
    state['started'] = True
    state['current_index'] = 0
    state['question_stats'] = []
    state['feedback_data'] = []
    state['feedback_phase'] = False
    reset_answers()
    payload = current_question_payload()
    socketio.emit('question_data', payload)  # broadcast to everyone
    emit('answer_update', {'counts': state['answer_counts'], 'total': 0}, room='host_room')


@socketio.on('next_question')
def on_next_question():
    if request.sid != state['host_sid']:
        return
    snapshot_current_question()
    next_idx = state['current_index'] + 1
    if next_idx >= len(QUESTIONS):
        # Enter feedback phase instead of ending immediately
        state['started'] = False
        state['current_index'] = -1
        state['feedback_phase'] = True
        state['feedback_data'] = []
        # Ask players for feedback
        socketio.emit('collect_feedback')
        # Tell host to show feedback waiting screen
        emit('feedback_phase', {
            'stats': state['question_stats'],
            'player_count': len(state['players']),
        }, room='host_room')
        return
    state['current_index'] = next_idx
    reset_answers()
    payload = current_question_payload()
    socketio.emit('question_data', payload)
    emit('answer_update', {'counts': state['answer_counts'], 'total': 0}, room='host_room')


@socketio.on('reset_game')
def on_reset_game():
    if request.sid != state['host_sid']:
        return
    state['started'] = False
    state['current_index'] = -1
    state['question_stats'] = []
    state['feedback_data'] = []
    state['feedback_phase'] = False
    state['game_code'] = generate_code()   # new code each reset
    reset_answers()
    # Keep players connected, just go back to lobby
    socketio.emit('game_reset')
    emit('host_ack', {
        'player_count': len(state['players']),
        'started': False,
        'question_count': len(QUESTIONS),
        'game_code': state['game_code'],
    }, room='host_room')


@socketio.on('regenerate_code')
def on_regenerate_code():
    if request.sid != state['host_sid']:
        return
    state['game_code'] = generate_code()
    emit('code_updated', {'game_code': state['game_code']})


# ── Socket events: PLAYER ──────────────────────────────────────────────────
@socketio.on('join_as_player')
def on_join_as_player(data):
    code = str(data.get('code', '')).strip()
    if code != state['game_code']:
        emit('join_error', {'message': 'Wrong game code. Try again.'})
        return
    name = str(data.get('name', 'Anonymous')).strip()[:30]
    if not name:
        name = 'Anonymous'
    state['players'][request.sid] = name
    player_count = len(state['players'])

    # Tell host about new player
    socketio.emit('player_joined', {'count': player_count}, room='host_room')

    # If game already in progress, send current question immediately
    if state['started'] and state['current_index'] >= 0:
        emit('question_data', current_question_payload())
    else:
        emit('waiting', {'message': 'Waiting for host to start the game...'})


@socketio.on('submit_answer')
def on_submit_answer(data):
    sid = request.sid
    if sid not in state['players']:
        return
    if not state['started']:
        return
    if sid in state['answers']:
        return  # already answered this question

    try:
        idx = int(data.get('answer_index'))
    except (TypeError, ValueError):
        return

    if idx not in (0, 1, 2, 3):
        return

    state['answers'][sid] = idx
    state['answer_counts'][idx] += 1
    state['answer_details'].append({
        'name': state['players'][sid],
        'answer_index': idx,
    })

    total_answered = len(state['answers'])
    # Broadcast live counts + individual response only to host
    socketio.emit('answer_update', {
        'counts': state['answer_counts'],
        'total': total_answered,
        'player_count': len(state['players']),
        'latest': {'name': state['players'][sid], 'answer_index': idx},
    }, room='host_room')


@socketio.on('submit_feedback')
def on_submit_feedback(data):
    sid = request.sid
    if sid not in state['players']:
        return
    if not state['feedback_phase']:
        return

    try:
        rating = int(data.get('rating', 0))
    except (TypeError, ValueError):
        rating = 0
    rating = max(0, min(5, rating))

    comment = str(data.get('comment', '')).strip()[:500]
    contact = str(data.get('contact', '')).strip()[:100]

    state['feedback_data'].append({
        'name': state['players'][sid],
        'rating': rating,
        'comment': comment,
        'contact': contact,
    })

    count = len(state['feedback_data'])
    socketio.emit('feedback_update', {
        'count': count,
        'player_count': len(state['players']),
    }, room='host_room')


@socketio.on('end_game')
def on_end_game():
    if request.sid != state['host_sid']:
        return
    state['feedback_phase'] = False
    socketio.emit('game_over', {
        'stats': state['question_stats'],
        'feedback': state['feedback_data'],
    })


# ── Socket events: DISCONNECT ─────────────────────────────────────────────────
@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    if sid == state['host_sid']:
        state['host_sid'] = None
    if sid in state['players']:
        del state['players'][sid]
        if sid in state['answers']:
            # Undo their answer from counts to keep data accurate
            idx = state['answers'][sid]
            state['answer_counts'][idx] = max(0, state['answer_counts'][idx] - 1)
            del state['answers'][sid]
        socketio.emit('player_joined', {'count': len(state['players'])}, room='host_room')


if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5000))
    print("Starting Pingo server...")
    print(f"Host view : http://127.0.0.1:{port}/host")
    print(f"Player view: http://127.0.0.1:{port}/player")
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
