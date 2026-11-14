import numpy as np

FPS = 30


def q_axis(axis, degrees):
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    half = np.radians(degrees) / 2
    return np.array([*(axis * np.sin(half)), np.cos(half)])


def q_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def q_slerp(a, b, u):
    a, b = np.asarray(a, float), np.asarray(b, float)
    dot = np.dot(a, b)
    if dot < 0:
        b, dot = -b, -dot
    if dot > 0.9995:
        q = a + u * (b - a)
        return q / np.linalg.norm(q)
    theta = np.arccos(dot)
    return (np.sin((1 - u) * theta) * a + np.sin(u * theta) * b) / np.sin(theta)


def _smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def _times(duration):
    return np.linspace(0, duration, int(round(duration * FPS)) + 1)


def _sides():
    return (("R", -1), ("L", 1))


def breathing():
    t = _times(4.0)
    phase = (1 - np.cos(2 * np.pi * t / 4.0)) / 2
    scale = np.stack([np.ones_like(t), 1 + 0.010 * phase, 1 + 0.025 * phase], axis=1)
    animation = {"chest": {"scale": (t, scale)}}
    for side, sign in _sides():
        rotation = np.array([q_axis([0, 0, 1], sign * 1.5 * p) for p in phase])
        animation[f"shoulder_{side}"] = {"rotation": (t, rotation)}
    return animation


def six_seven():
    entry, cycle, n_cycles = 0.4, 0.8, 3
    middle = n_cycles * cycle
    t = _times(entry + middle + entry)

    envelope = _smooth(t / entry) * (1 - _smooth((t - entry - middle) / entry))
    oscillation = np.sin(2 * np.pi * np.clip(t - entry, 0, middle) / cycle)

    animation = {}
    for side, sign in _sides():
        phase_direction = 1 if side == "L" else -1
        flexion = -85 * envelope + 35 * envelope * oscillation * phase_direction
        supination = 90 * envelope * sign
        elbow = np.array([q_mul(q_axis([1, 0, 0], f), q_axis([0, 1, 0], p)) for f, p in zip(flexion, supination)])
        shoulder = np.array([q_mul(q_axis([1, 0, 0], -12 * k), q_axis([0, 0, 1], sign * 8 * k)) for k in envelope])
        animation[f"elbow_{side}"] = {"rotation": (t, elbow)}
        animation[f"shoulder_{side}"] = {"rotation": (t, shoulder)}
    return animation


def _arm_poses(sign):
    identity = np.array([0, 0, 0, 1.0])
    return {
        "rest": (identity, identity),
        "heart": (q_mul(q_mul(q_axis([1, 0, 0], -18), q_axis([0, 0, 1], sign * 38)), q_axis([0, 1, 0], -sign * 70)),
                  q_axis([1, 0, 0], -118)),
        "side": (q_mul(q_axis([0, 0, 1], sign * 95), q_axis([1, 0, 0], -5)), q_axis([1, 0, 0], -10)),
        "up": (q_mul(q_axis([0, 0, 1], sign * 160), q_axis([1, 0, 0], -8)), q_axis([0, 0, 1], sign * 25)),
    }


def deep_breath():
    keys = [
        (0.0, "rest", 0, None), (1.2, "heart", 0, None), (1.8, "heart", 0, None),
        (4.6, "up", 1, "side"), (5.2, "up", 1, None), (8.2, "heart", 0, "side"), (8.8, "heart", 0, None),
        (11.6, "up", 1, "side"), (12.2, "up", 1, None), (15.2, "heart", 0, "side"), (15.8, "heart", 0, None),
        (17.1, "rest", 0, None),
    ]
    t = _times(keys[-1][0])
    key_times = np.array([k[0] for k in keys])

    def sample(time):
        i = min(np.searchsorted(key_times, time, side="right") - 1, len(keys) - 2)
        (t0, pose0, inhale0, _), (t1, pose1, inhale1, via) = keys[i], keys[i + 1]
        u = float(_smooth((time - t0) / (t1 - t0)))
        inhale = inhale0 + (inhale1 - inhale0) * u
        if via is None:
            return pose0, pose1, u, inhale
        return (pose0, via, 2 * u, inhale) if u < 0.5 else (via, pose1, 2 * u - 1, inhale)

    samples = [sample(time) for time in t]
    inhale = np.array([s[3] for s in samples])
    scale = np.stack([1 + 0.02 * inhale, 1 + 0.03 * inhale, 1 + 0.07 * inhale], axis=1)
    animation = {"chest": {"scale": (t, scale)}}
    for side, sign in _sides():
        poses = _arm_poses(sign)
        shoulder = np.array([q_slerp(poses[a][0], poses[b][0], u) for a, b, u, _ in samples])
        elbow = np.array([q_slerp(poses[a][1], poses[b][1], u) for a, b, u, _ in samples])
        animation[f"shoulder_{side}"] = {"rotation": (t, shoulder)}
        animation[f"elbow_{side}"] = {"rotation": (t, elbow)}
    return animation


def namaste():
    keys = [(0.0, 0, 0), (1.0, 1, 0), (1.4, 1, 0), (2.6, 1, 1), (3.6, 1, 1),
            (4.8, 1, 0), (5.2, 1, 0), (6.2, 0, 0)]
    t = _times(keys[-1][0])
    key_times = np.array([k[0] for k in keys])
    hands, bow = np.zeros_like(t), np.zeros_like(t)
    for j, time in enumerate(t):
        i = min(np.searchsorted(key_times, time, side="right") - 1, len(keys) - 2)
        (t0, hands0, bow0), (t1, hands1, bow1) = keys[i], keys[i + 1]
        u = float(_smooth((time - t0) / (t1 - t0)))
        hands[j], bow[j] = hands0 + (hands1 - hands0) * u, bow0 + (bow1 - bow0) * u

    animation = {
        "waist": {"rotation": (t, np.array([q_axis([1, 0, 0], 28 * b) for b in bow]))},
        "neck": {"rotation": (t, np.array([q_axis([1, 0, 0], 14 * b) for b in bow]))},
    }
    for side, sign in _sides():
        rest, heart = _arm_poses(sign)["rest"], _arm_poses(sign)["heart"]
        animation[f"shoulder_{side}"] = {"rotation": (t, np.array([q_slerp(rest[0], heart[0], h) for h in hands]))}
        animation[f"elbow_{side}"] = {"rotation": (t, np.array([q_slerp(rest[1], heart[1], h) for h in hands]))}
    return animation


def wave():
    entry, cycle, n_cycles = 0.6, 0.45, 4
    middle = n_cycles * cycle
    t = _times(entry + middle + entry)
    envelope = _smooth(t / entry) * (1 - _smooth((t - entry - middle) / entry))
    oscillation = np.sin(2 * np.pi * np.clip(t - entry, 0, middle) / cycle)

    sign = -1
    shoulder = np.array([q_mul(q_axis([1, 0, 0], -12 * k), q_axis([0, 0, 1], sign * 45 * k)) for k in envelope])
    elbow = np.array([q_mul(q_axis([0, 0, 1], sign * (115 + 20 * o) * k), q_axis([0, 1, 0], sign * 90 * k))
                      for k, o in zip(envelope, oscillation)])
    return {"shoulder_R": {"rotation": (t, shoulder)}, "elbow_R": {"rotation": (t, elbow)}}


ANIMATIONS = {
    "breathing": breathing,
    "six_seven": six_seven,
    "deep_breath": deep_breath,
    "namaste": namaste,
    "wave": wave,
}
