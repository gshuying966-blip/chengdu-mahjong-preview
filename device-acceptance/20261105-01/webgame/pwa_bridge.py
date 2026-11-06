'''In-browser transport: mirrors server.py's HTTP endpoints as plain
   functions taking/returning JSON strings, so worker.js can call them
   through Pyodide without any JS<->Python object marshalling. One
   GameSession lives at module scope, same single-session model as the
   desktop server (no threading needed — Pyodide runs single-threaded).
'''
import json
import time

from game_core import GameSession, STRATEGIES, compute_daily_par

SESSION = None


def api_new(payload_json):
    global SESSION
    payload = json.loads(payload_json) if payload_json else {}
    if not isinstance(payload, dict):
        return json.dumps({'error': '无效的请求格式', '_status': 400})
    if payload.get('daily') or 'seed' in payload:
        return json.dumps({'error': '网页教学模式不接受公开随机种子', '_status': 400})
    try:
        SESSION = GameSession(ai=payload.get('ai', 'initial'),
                              exchange_direction=payload.get('exchange_direction'),
                              exchange_enabled=payload.get('exchange_enabled', True))
    except ValueError as e:
        return json.dumps({'error': str(e), '_status': 400})
    return json.dumps(SESSION.state())


def api_act(payload_json):
    if SESSION is None:
        return json.dumps({'error': 'no game', '_status': 400})
    payload = json.loads(payload_json)
    try:
        SESSION.human_act(payload)
    except ValueError as e:
        return json.dumps({'error': str(e), '_status': 400})
    return json.dumps(SESSION.state())


def api_step():
    if SESSION is None:
        return json.dumps({'error': 'no game', '_status': 400})
    stepped = SESSION.step_once()
    st = SESSION.state()
    st['stepped'] = stepped
    return json.dumps(st)


def api_state():
    return json.dumps(SESSION.state() if SESSION else {'stage': 'none'})


def api_hint():
    if SESSION is None or SESSION.pending is None:
        return json.dumps({})
    try:
        return json.dumps(SESSION.hint())
    except Exception:
        return json.dumps({'error': 'hint failed', '_status': 500})


def api_hand_math():
    return json.dumps(SESSION.hand_math() if SESSION else
                     {'analysis':{'status':'unavailable','errors':['请先开始一局']}})


def api_daily_par():
    seed = getattr(SESSION, 'daily_seed', None) if SESSION else None
    if seed is None:
        return json.dumps({'error': 'no daily game', '_status': 400})
    return json.dumps({'seed': seed, 'par': compute_daily_par(seed)})


def strategies_available():
    return json.dumps(sorted(STRATEGIES.keys()))
