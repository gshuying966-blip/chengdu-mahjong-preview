#@20.01.29 adapted for xuezhan
import utils.pusolx as ps
from utils.xzutils import *

''' hysol.py and pusol.py do not conisder the knowledge base, and thus the result is differnt from hyval in hytreekong.py'''
#Bamboo, Character, Dot
#h_tile = list([x,y] for x in range(0,3) for y in range(1,10))

def is_h_solx(H, dc):
    ''' Check if a hybrid k-tile (k=14-3*pg) H is xuezhan-complete
        Args:
            H (list): a hybrid k-tile
            dc (int): the daque color
        Return:
            (Bool)
    '''
    if list(x for x in H if x[0] == dc):
        return False
    if numPair(H) == 7: #2020021507-sl: 7-pair solutions added
        return True
    
    V_b = hand_bp(H)[:]
    V_c = hand_cp(H)[:]
    V_d = hand_dp(H)[:]

    if min(len(V_b),len(V_c),len(V_d)) > 0:
        return False
    if (len(V_b)+len(V_c)+len(V_d)) % 3 != 2:
        return False
    
    if ps.is_solx(V_b) and ps.is_solx(V_c) and ps.is_solx(V_d):
        return True
    else:
        return False
    
def numS(T, Pg, KB, dc):
    ''' The number of tiles that can complete T
        Args:
            T (list):  list of mahjong tiles with form [[0,0]]*l
            Pg (list): list of ponged tiles with form  [[0,0]]*k
            KB (list): knowledge base with form [4]*27
            dc (int): the discard (daque) color of the player
        Return:
            num (int): the number of tiles that can complete T
    '''
    if list(t for t in T if t[0] == dc):
        return 0
    X = list(t for t in MJ() if t[0] != dc and KB[kbf(t)])
    num = 0
    for x in X:
        U = T[:]
        U.append(x)
        U.sort()
        if is_h_solx(U,dc): 
            num += KB[kbf(x)]  
              
    return num
    
def analyze_visible_hand(hand, melds, public_tiles, daque, allowed_discards=None,
                         wall_count=None, claim_tile=None):
    '''Validated, deterministic teaching analysis. No game objects or hidden data.

    public_tiles is a PHYSICAL multiset, excluding own melds and own hand.
    Its caller includes opponents' open melds and the physical table exactly once.
    '''
    from collections import Counter

    def invalid(message):
        return {'status': 'invalid', 'errors': [message], 'version': 'hand-math-v1'}

    def tile_ok(t):
        return (isinstance(t, list) and len(t) == 2 and type(t[0]) is int
                and type(t[1]) is int and 0 <= t[0] < 3 and 1 <= t[1] <= 9)

    if type(daque) is not int or daque not in (0, 1, 2):
        return invalid('必须先确定合法的定缺花色')
    if not all(isinstance(v, list) for v in (hand, melds, public_tiles)):
        return invalid('手牌、副露和公开牌必须是列表')
    if len(melds) > 4:
        return invalid('公开副露不能超过四组')
    for group in melds:
        if (not isinstance(group, list) or len(group) not in (3, 4)
                or not all(tile_ok(t) for t in group)
                or any(t != group[0] for t in group)):
            return invalid('本规则副露只能是三张同牌的碰或四张同牌的杠')
        if group[0][0] == daque:
            return invalid('定缺花色不能成为自己的碰杠副露')
    if not all(tile_ok(t) for t in hand + public_tiles):
        return invalid('存在非法牌面；仅支持条万筒1至9')
    waiting_size = 13 - 3*len(melds)
    if len(hand) not in (waiting_size, waiting_size+1):
        return invalid('暗手数量必须为13-3×副露组数或14-3×副露组数；杠也只占一组')
    own = Counter(map(tuple, hand + [t for group in melds for t in group]))
    known = own + Counter(map(tuple, public_tiles))
    if any(n > 4 for n in known.values()):
        return invalid('自己与公开区域中同一种牌合计超过四张，不能计算可信结果')
    unseen = [4-known[(c,n)] for c in range(3) for n in range(1,10)]
    if wall_count is not None and (type(wall_count) is not int or not 0 <= wall_count <= sum(unseen)):
        return invalid('牌墙总张数与可见牌守恒上界不符')
    ready = len(hand) == waiting_size+1
    legal = sorted({tuple(t) for t in hand if not any(x[0] == daque for x in hand) or t[0] == daque})
    if allowed_discards is not None:
        if (not isinstance(allowed_discards, list) or not all(tile_ok(t) for t in allowed_discards)
                or any(tuple(t) not in legal for t in allowed_discards)
                or (not ready and allowed_discards)):
            return invalid('弃牌列表包含当前手牌和定缺规则不允许的动作')
        legal = sorted(set(map(tuple, allowed_discards)))
    if claim_tile is not None and (not tile_ok(claim_tile) or ready or claim_tile not in public_tiles):
        return invalid('响应牌必须是当前已经公开的一张牌，且暗手尚待补一张')

    def is_complete(tiles):
        # Length, own physical copy cap, meld structure and daque were validated.
        # Legacy numPair/numKong explicitly require sorted tiles. Never sort caller input.
        return bool(is_h_solx(sorted(tiles, key=lambda t:(t[0],t[1])), daque))

    def describe(tiles):
        if len(tiles) == waiting_size+1:
            return {'is_complete':is_complete(tiles),'is_tenpai':None,'has_unseen_wait':None,
                    'waits':[],'wait_types':None,'unseen_total':None}
        rows = []
        if len(tiles) == waiting_size:
            counts = Counter(map(tuple, tiles + [t for group in melds for t in group]))
            for c in range(3):
                for n in range(1,10):
                    tile = [c,n]
                    if counts[(c,n)] < 4 and is_complete(tiles + [tile]):
                        rows.append({'tile':tile, 'unseen':unseen[c*9+n-1]})
        return {'is_complete': len(tiles) == waiting_size+1 and is_complete(tiles),
                'is_tenpai': bool(rows), 'has_unseen_wait': any(r['unseen'] > 0 for r in rows),
                'waits':rows, 'wait_types':len(rows),
                'unseen_total':sum(r['unseen'] for r in rows)}

    current = describe(hand)
    current['wins_with_claim'] = (claim_tile is not None and
                                 any(r['tile'] == claim_tile for r in current['waits']))
    discards = []
    if ready:
        for tile in legal:
            rest = [list(t) for t in hand]
            rest.remove(list(tile))
            # Discard moves a tile to the public table: original unseen stays fixed.
            discards.append(dict(describe(rest), tile=list(tile)))
    best = max((row['unseen_total'] for row in discards), default=0)
    best_tiles = [row['tile'] for row in discards if best > 0 and row['unseen_total'] == best]
    if not best_tiles:
        message = '没有可据此比较的即时未见待牌；本阶段不计算多步改良，无法给出明确优劣。'
    elif len(best_tiles) > 1:
        message = '按即时听牌的基础未见合计，这些选择并列；不提供唯一最优结论。'
    else:
        message = '仅按即时听牌的基础未见合计倾向这个选择；不代表更安全或收益最高。'
    return {'status':'ok', 'version':'hand-math-v1', 'current':current, 'discards':discards,
            'unseen':unseen, 'wall_count':wall_count, 'missing_suit_remaining':sum(t[0] == daque for t in hand),
            'count_basis':'4减自己暗手、自己副露、其他家公开副露和公开留桌物理牌；历史碰杠引用不重复扣。',
            'information_limits':[
                '未见张数包括对手暗牌，不能确定其中多少在牌墙内，也不是摸牌概率。',
                '换牌送出记录不额外扣减：无法跟踪物理副本时可能与后来公开的牌重复。',
                '这里只校验可见输入；不证明未知暗牌或整局所有历史都合法。'],
            'unsupported':['多步精确向听与改良搜索','番型收益比较','对手听牌或点炮概率'],
            'suggestion':{'kind':'heuristic', 'metric':'immediate_unseen_sum', 'tiles':best_tiles,
                          'optimality_proven':False, 'message':message,
                          'not_considered':['对手危险度','番数与分账收益','后续摸打和碰杠机会','未知牌真实位置']}}


#\__/#\#/\#\__/#\#/\__/--\__/#\__/#\#/~\

if __name__ == '__main__':
    # main_test
    import time
    start = time.time()

    dc = 1 
    c = 2 
    T = [[0, 2], [0, 2], [0, 4], [0, 4], [2, 7], [2, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4]] 
    Pg =  [] 
    KB = [4, 2, 4, 2, 4, 4, 1, 4, 4, 4, 4, 1, 4, 4, 4, 4, 3, 4, 2, 1, 2, 1, 4, 3, 2, 4, 3]
    print(KB[kbf([2, 7])])
    print(numPair(T))
    print(numS(T, Pg, KB, dc))
    
    end = time.time()
    print('It takes %s seconds' %(end-start))
