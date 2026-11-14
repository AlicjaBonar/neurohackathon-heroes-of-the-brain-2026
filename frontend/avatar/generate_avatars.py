import json
import os

import numpy as np
import trimesh
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial

COMPONENTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "components")

SKIN = (0.94, 0.76, 0.64)
CLOTHING_F = (0.70, 0.35, 0.50)
CLOTHING_M = (0.25, 0.42, 0.68)
TROUSERS = (0.18, 0.22, 0.33)
SHOES = (0.15, 0.12, 0.10)
EYE_WHITE = (0.97, 0.97, 0.97)
IRIS = (0.20, 0.30, 0.45)
MOUTH = (0.75, 0.42, 0.42)
DRAWSTRING = (0.92, 0.92, 0.92)
PLACEHOLDER_COLOR = (0.5, 0.5, 0.5)

HEAD_RADII = np.array([0.056, 0.068, 0.063])
SHOULDER_Y = 0.815 - 0.925

TEXTURES = ["straight", "wavy", "curly", "bald"]
LENGTHS = ["short", "long"]


def make_material(rgb):
    linear = [c ** 2.2 for c in rgb]
    return PBRMaterial(baseColorFactor=[*linear, 1.0], metallicFactor=0.0, roughnessFactor=0.75)


def _ellipsoid(center, radii, subdivisions=3):
    mesh = trimesh.creation.icosphere(subdivisions=subdivisions, radius=1.0)
    mesh.apply_scale(radii)
    mesh.apply_translation(center)
    return mesh


def _hull(*solids):
    return trimesh.convex.convex_hull(np.vstack([s.vertices for s in solids]))


def _inflate(mesh, margin):
    mesh.vertices = mesh.vertices + mesh.vertex_normals * margin
    return mesh


def _front_z(mesh, x, y):
    segments = trimesh.intersections.mesh_plane(mesh, [0, 1, 0], [0, y, 0])
    points = segments.reshape(-1, 3)
    points = points[points[:, 2] > 0]
    return float(points[np.argsort(np.abs(points[:, 0] - x))[:4], 2].mean())


def _darken(rgb, factor=0.82):
    return tuple(c * factor for c in rgb)


def _segment(p1, p2, r1, r2):
    return _hull(_ellipsoid(p1, [r1] * 3), _ellipsoid(p2, [r2] * 3))


class _SceneBuilder:
    def __init__(self):
        self.scene = trimesh.Scene()
        self.count = 0
        self.joints = {}

    def joint(self, name, pivot, parent=None):
        pivot = np.asarray(pivot, float)
        base = self.joints[parent] if parent else np.zeros(3)
        transform = np.eye(4)
        transform[:3, 3] = pivot - base
        self.scene.graph.update(frame_from=parent or self.scene.graph.base_frame, frame_to=name, matrix=transform)
        self.joints[name] = pivot

    def add(self, name, mesh, rgb, joint=None):
        mesh = mesh.copy()
        mesh.visual = TextureVisuals(material=make_material(rgb))
        if joint:
            mesh.apply_translation(-self.joints[joint])
            self.scene.add_geometry(mesh, geom_name=f"{name}_{self.count}", parent_node_name=joint)
        else:
            self.scene.add_geometry(mesh, geom_name=f"{name}_{self.count}")
        self.count += 1


def build_body(sex, age=25, weight=None):
    builder = _SceneBuilder()
    female = sex == "F"
    if weight is None:
        weight = 58 if female else 74

    height = (1.64 if female else 1.78) * (1.0 - max(0, age - 50) * 0.002)
    girth = float(np.clip(weight / (58 if female else 74), 0.8, 1.7))
    belly = max(0.0, girth - 1.0)
    elderly = age >= 60

    top_color = CLOTHING_F if female else CLOTHING_M

    shoulder_x = height * (0.086 if female else 0.096) * (1 + 0.15 * (girth - 1))
    hip_x = height * (0.058 if female else 0.047) * (1 + 0.20 * (girth - 1))
    head_lean = 0.012 * height if elderly else 0.0

    shoulder_y = 0.815 * height
    builder.joint("waist", [0, 0.56 * height, 0])
    builder.joint("chest", [0, 0.60 * height, 0], parent="waist")
    if female:
        rib_cage = _ellipsoid([0, 0.715 * height, 0],
                              [shoulder_x * 0.95, 0.075 * height, 0.066 * height * (1 + 0.25 * belly)])
        shoulder_r = 0.031 * height * girth ** 0.5
        waist_rx = hip_x * 1.55 * girth ** 0.6 * 0.85
    else:
        rib_cage = _ellipsoid([0, 0.72 * height, 0.004 * height],
                              [shoulder_x * 1.05, 0.08 * height, 0.072 * height * (1 + 0.2 * belly)])
        shoulder_r = 0.036 * height * girth ** 0.45
        waist_rx = 0.084 * height * girth ** 0.6
    shoulders = [_ellipsoid([s * shoulder_x, shoulder_y - 0.012 * height, -0.004 * height], [shoulder_r] * 3)
                 for s in (-1, 1)]
    nape = _ellipsoid([0, 0.835 * height, -0.006 * height],
                      [(0.042 if female else 0.05) * height * girth ** 0.4, 0.018 * height, 0.034 * height])
    waist = _ellipsoid([0, 0.625 * height, 0.012 * height * belly],
                       [waist_rx, 0.06 * height, 0.06 * height * (1 + 0.7 * belly)])
    torso_parts = [rib_cage, *shoulders, nape, waist]
    if not female:
        torso_parts += [_ellipsoid([s * shoulder_x * 0.82, 0.69 * height, -0.012 * height],
                                   [0.03 * height, 0.06 * height, 0.045 * height]) for s in (-1, 1)]
    if female:
        torso_parts += [_ellipsoid([s * 0.038 * height, 0.722 * height, 0.045 * height * (1 + 0.2 * belly)],
                                   [0.033 * height, 0.028 * height, 0.03 * height]) for s in (-1, 1)]
    if female:
        builder.add("torso", _hull(*torso_parts), top_color, joint="chest")
    else:
        lower_body = _ellipsoid([0, 0.54 * height, 0.008 * height * belly],
                                [0.088 * height * girth ** 0.6, 0.02 * height, 0.064 * height * (1 + 0.6 * belly)])
        hoodie = _inflate(_hull(*torso_parts, lower_body), 0.010 * height)
        builder.add("hoodie", hoodie, top_color, joint="chest")
        trim_color = _darken(top_color)
        builder.add("hem", _ellipsoid([0, 0.535 * height, 0.008 * height * belly],
                                      [0.099 * height * girth ** 0.6, 0.013 * height,
                                       0.075 * height * (1 + 0.6 * belly)]), trim_color)
        hood = _hull(_ellipsoid([0, 0.845 * height, -0.052 * height], [0.07 * height, 0.04 * height, 0.035 * height]),
                     *[_ellipsoid([s * 0.05 * height, 0.83 * height, -0.012 * height],
                                  [0.026 * height, 0.026 * height, 0.03 * height]) for s in (-1, 1)])
        builder.add("hood", hood, trim_color, joint="chest")
        pocket_y = 0.595 * height
        pocket_z = _front_z(hoodie, 0.0, pocket_y)
        builder.add("pocket", _ellipsoid([0, pocket_y, pocket_z - 0.006 * height],
                                         [0.062 * height * girth ** 0.6, 0.036 * height, 0.010 * height]),
                    trim_color, joint="chest")
        for s in (-1, 1):
            x = s * 0.016 * height
            p1 = [x, 0.805 * height, _front_z(hoodie, x, 0.805 * height) + 0.002 * height]
            p2 = [x * 1.1, 0.735 * height, _front_z(hoodie, x * 1.1, 0.735 * height) + 0.002 * height]
            builder.add("drawstring", _segment(p1, p2, 0.0035 * height, 0.0035 * height), DRAWSTRING,
                        joint="chest")

    belt_rx = hip_x * 1.6 * girth ** 0.5 * 0.85 if female else waist_rx * 0.97
    belt = _ellipsoid([0, 0.60 * height, 0.008 * height * belly],
                      [belt_rx, 0.03 * height, 0.058 * height * (1 + 0.6 * belly)])
    pelvis_rx = hip_x + 0.045 * height * girth ** 0.6 if female else 0.090 * height * girth ** 0.6
    pelvis = _ellipsoid([0, 0.535 * height, 0], [pelvis_rx, 0.055 * height, 0.062 * height * girth ** 0.4])
    builder.add("pelvis", _hull(belt, pelvis), TROUSERS)

    r_thigh = (0.050 if female else 0.046) * height * girth ** 0.7
    r_knee = 0.031 * height * girth ** 0.5
    r_ankle = 0.020 * height * girth ** 0.3
    for s in (-1, 1):
        hip = np.array([s * hip_x, 0.52 * height, 0.0])
        knee_spread = 1.0 if not female else 0.92
        knee = np.array([s * hip_x * knee_spread, 0.285 * height, 0.006 * height])
        ankle = np.array([s * hip_x * (1.0 if not female else 0.88), 0.055 * height, -0.004 * height])
        if female:
            builder.add("thigh", _segment(hip, knee, r_thigh, r_knee), TROUSERS)
            builder.add("calf", _segment(knee, ankle, r_knee * 0.98, r_ankle), TROUSERS)
        else:
            builder.add("thigh", _segment(hip, knee, 0.054 * height * girth ** 0.6, 0.046 * height * girth ** 0.5),
                        TROUSERS)
            builder.add("calf", _segment(knee, ankle + [0, 0.010 * height, 0], 0.046 * height * girth ** 0.5,
                                         0.043 * height * girth ** 0.4), TROUSERS)
        shoe = _hull(_ellipsoid([ankle[0], 0.03 * height, -0.01 * height], [0.026 * height, 0.03 * height, 0.032 * height]),
                     _ellipsoid([ankle[0], 0.018 * height, 0.06 * height], [0.024 * height, 0.018 * height, 0.03 * height]))
        builder.add("shoe", shoe, SHOES)

    arm_scale = 1.0 if female else 1.12
    r_upper = 0.027 * height * girth ** 0.6 * arm_scale
    r_elbow = 0.020 * height * girth ** 0.5 * arm_scale
    r_wrist = 0.0155 * height * girth ** 0.35 * arm_scale
    for s in (-1, 1):
        shoulder_pt = np.array([s * shoulder_x, shoulder_y - 0.015 * height, -0.004 * height])
        elbow_pt = np.array([s * (shoulder_x + 0.022 * height * girth ** 0.5), shoulder_y - 0.19 * height,
                             -0.01 * height])
        wrist_pt = np.array([s * (shoulder_x + 0.032 * height * girth ** 0.5), shoulder_y - 0.335 * height,
                             0.012 * height])
        side = "R" if s < 0 else "L"
        shoulder_joint, elbow_joint = f"shoulder_{side}", f"elbow_{side}"
        builder.joint(shoulder_joint, shoulder_pt, parent="waist")
        builder.joint(elbow_joint, elbow_pt, parent=shoulder_joint)
        sleeve_end = shoulder_pt + (elbow_pt - shoulder_pt) * 0.42
        if female:
            builder.add("upper_arm", _segment(shoulder_pt, elbow_pt, r_upper, r_elbow), SKIN, joint=shoulder_joint)
            builder.add("forearm", _segment(elbow_pt, wrist_pt, r_elbow, r_wrist), SKIN, joint=elbow_joint)
            builder.add("sleeve", _segment(shoulder_pt, sleeve_end, r_upper * 1.25, r_upper * 1.12), top_color,
                        joint=shoulder_joint)
        else:
            girth_root = girth ** 0.5
            biceps = _ellipsoid(shoulder_pt + (elbow_pt - shoulder_pt) * 0.55 + [0, 0, 0.009 * height],
                                [0.031 * height * girth_root, 0.055 * height, 0.032 * height * girth_root])
            triceps = _ellipsoid(shoulder_pt + (elbow_pt - shoulder_pt) * 0.45 + [0, 0, -0.010 * height],
                                 [0.030 * height * girth_root, 0.06 * height, 0.030 * height * girth_root])
            builder.add("upper_arm", _hull(_ellipsoid(shoulder_pt, [r_upper] * 3), biceps, triceps,
                                           _ellipsoid(elbow_pt, [r_elbow] * 3)), SKIN, joint=shoulder_joint)
            forearm_muscle = _ellipsoid(elbow_pt + (wrist_pt - elbow_pt) * 0.28,
                                        [0.026 * height * girth_root, 0.045 * height, 0.025 * height * girth_root])
            builder.add("forearm", _hull(_ellipsoid(elbow_pt, [r_elbow] * 3), forearm_muscle,
                                         _ellipsoid(wrist_pt, [r_wrist] * 3)), SKIN, joint=elbow_joint)
            sleeve_wrist = elbow_pt + (wrist_pt - elbow_pt) * 0.86
            builder.add("sleeve", _segment(shoulder_pt, elbow_pt, 0.048 * height * girth_root,
                                           0.042 * height * girth_root), top_color, joint=shoulder_joint)
            builder.add("sleeve", _segment(elbow_pt, sleeve_wrist, 0.042 * height * girth_root,
                                           0.034 * height * girth_root), top_color, joint=elbow_joint)
            builder.add("cuff", _segment(sleeve_wrist, elbow_pt + (wrist_pt - elbow_pt) * 0.97,
                                         0.030 * height * girth_root, 0.028 * height * girth_root),
                        _darken(top_color), joint=elbow_joint)
        hand = _hull(_ellipsoid(wrist_pt + [0, -0.03 * height, 0.002 * height],
                                [0.014 * height, 0.03 * height, 0.022 * height]),
                     _ellipsoid(wrist_pt + [0, -0.065 * height, 0.004 * height],
                                [0.010 * height, 0.02 * height, 0.016 * height]))
        builder.add("hand", hand, SKIN, joint=elbow_joint)

    head_y = 0.925 * height
    head_z = head_lean
    builder.joint("neck", [0, shoulder_y, -0.004 * height], parent="waist")
    builder.add("neck", _segment([0, shoulder_y - 0.01 * height, -0.004 * height], [0, 0.875 * height, head_z * 0.6],
                                 (0.031 if female else 0.038) * height * girth ** 0.3,
                                 (0.027 if female else 0.032) * height), SKIN, joint="neck")
    radii = HEAD_RADII * height
    skull = _ellipsoid([0, head_y, head_z], radii)
    jaw = _ellipsoid([0, head_y - 0.042 * height, head_z + 0.018 * height],
                     [0.037 * height * girth ** 0.25, 0.026 * height, 0.038 * height])
    builder.add("head", _hull(skull, jaw), SKIN, joint="neck")

    face_z = head_z + radii[2]
    builder.add("nose", _ellipsoid([0, head_y - 0.010 * height, face_z - 0.003 * height],
                                   [0.0055 * height, 0.010 * height, 0.0075 * height]), SKIN, joint="neck")
    for s in (-1, 1):
        builder.add("ear", _ellipsoid([s * radii[0] * 0.98, head_y - 0.004 * height, head_z - 0.004 * height],
                                      [0.007 * height, 0.016 * height, 0.010 * height]), SKIN, joint="neck")
        eye_x = s * 0.022 * height
        builder.add("eye", _ellipsoid([eye_x, head_y + 0.008 * height, face_z - 0.012 * height],
                                      [0.0095 * height] * 3, subdivisions=2), EYE_WHITE, joint="neck")
        builder.add("iris", _ellipsoid([eye_x, head_y + 0.008 * height, face_z - 0.004 * height],
                                       [0.0055 * height] * 3, subdivisions=2), IRIS, joint="neck")
    t = np.linspace(-1, 1, 9)
    smile_arc = np.stack([t * 0.016 * height,
                          head_y - 0.042 * height + 0.008 * height * t ** 2,
                          face_z - 0.008 * height - 0.007 * height * t ** 2], axis=1)
    for i in range(len(smile_arc) - 1):
        builder.add("mouth", _segment(smile_arc[i], smile_arc[i + 1], 0.0028 * height, 0.0028 * height), MOUTH,
                    joint="neck")

    meta = {"H": height, "head": [0.0, head_y, head_z], "hair_joint": "neck"}
    return builder.scene, meta


def _wavy_strands(builder, length):
    radii = HEAD_RADII
    short = length == "short"
    end_y = -0.025 if short else SHOULDER_Y - 0.05
    base_scale, thickness = (1.03, 0.012) if short else (1.10, 0.016)
    for angle in np.radians(np.arange(70, 291, 14)):
        front = abs(np.cos(angle)) if np.cos(angle) > 0 else 0
        strand_end_y = max(end_y, -0.01) if front > 0.2 else end_y
        ys = np.linspace(0.035, strand_end_y, 10)
        points = []
        for i, y in enumerate(ys):
            wave = (0.004 if short else 0.007) * np.sin(i * 1.3 + angle * 3)
            scale = base_scale if y > -0.03 else base_scale - 0.08 * min(1, (-0.03 - y) / 0.05)
            points.append([np.sin(angle) * (radii[0] * scale + wave), y,
                           np.cos(angle) * (radii[2] * scale + wave) - 0.004])
        for p1, p2 in zip(points[:-1], points[1:]):
            builder.add("hair", _segment(p1, p2, thickness, thickness), PLACEHOLDER_COLOR)


def build_hair(texture, length="short"):
    builder = _SceneBuilder()
    radii = HEAD_RADII
    face_z = radii[2]

    for s in (-1, 1):
        builder.add("brows", _ellipsoid([s * 0.022, 0.024, face_z - 0.007], [0.013, 0.0028, 0.004]),
                    PLACEHOLDER_COLOR)

    if texture == "bald":
        fringe = _ellipsoid([0, 0, 0], radii * 1.04)
        fringe = trimesh.intersections.slice_mesh_plane(fringe, [0, -1, 0], [0, 0.25 * radii[1], 0])
        fringe = trimesh.intersections.slice_mesh_plane(fringe, [0, 1, 0], [0, -0.35 * radii[1], 0])
        fringe = trimesh.intersections.slice_mesh_plane(fringe, [0, 0, -1], [0, 0, 0.1 * radii[2]])
        builder.add("hair", fringe, PLACEHOLDER_COLOR)
        return builder.scene

    cap = _ellipsoid([0, 0, 0], radii * 1.06)
    cap = trimesh.intersections.slice_mesh_plane(cap, [0, 1, -0.55], [0, 0, 0])
    cap.apply_translation([0, 0.004, -0.003])
    builder.add("hair", cap, PLACEHOLDER_COLOR)

    if texture == "straight" and length == "long":
        back = _hull(_ellipsoid([0, 0, -0.012], radii * np.array([1.07, 0.6, 0.98])),
                     _ellipsoid([0, SHOULDER_Y - 0.035, -0.05], [0.065, 0.02, 0.025]))
        back = trimesh.intersections.slice_mesh_plane(back, [0, 0, -1], [0, 0, 0.012], cap=True)
        builder.add("hair", back, PLACEHOLDER_COLOR)

    elif texture == "wavy":
        waves = _ellipsoid([0, 0, 0], radii * 1.07, subdivisions=4)
        vertices = waves.vertices
        angle = np.arctan2(vertices[:, 0], vertices[:, 2])
        waves.vertices = vertices * (1 + 0.045 * np.sin(10 * angle + 9 * vertices[:, 1] / radii[1]))[:, None]
        waves = trimesh.intersections.slice_mesh_plane(waves, [0, 1, -0.55], [0, 0, 0])
        waves.apply_translation([0, 0.004, -0.004])
        builder.add("hair", waves, PLACEHOLDER_COLOR)
        if length == "long":
            _wavy_strands(builder, length)

    elif texture == "curly":
        rng = np.random.default_rng(7)
        bases = []

        head = _ellipsoid([0, 0, 0], radii * 1.04)
        head = trimesh.intersections.slice_mesh_plane(head, [0, 1, -0.55], [0, 0.02 * radii[1], 0], cap=True)
        builder.add("hair", head, PLACEHOLDER_COLOR)

        def on_head(point, normal):
            direction = point / (radii * 1.04)
            direction = direction / np.linalg.norm(direction)
            if direction[1] - 0.55 * direction[2] < 0.15:
                return False
            if normal @ np.array([0, -1, 0.55]) / np.linalg.norm([0, 1, 0.55]) > 0.9:
                return False
            return length == "long" or direction[1] > -0.2
        bases.append((head, 150, on_head))

        if length == "long":
            back = _hull(_ellipsoid([0, 0, -0.012], radii * np.array([1.12, 0.6, 1.0])),
                         _ellipsoid([0, SHOULDER_Y - 0.035, -0.05], [0.085, 0.025, 0.035]))
            back = trimesh.intersections.slice_mesh_plane(back, [0, 0, -1], [0, 0, 0.012], cap=True)
            builder.add("hair", back, PLACEHOLDER_COLOR)
            bases.append((back, 230, lambda point, normal: normal[2] < 0.5))

        for mesh, count, allowed in bases:
            points, face_ids = trimesh.sample.sample_surface_even(mesh, count, seed=7)
            for point, face_id in zip(points, face_ids):
                normal = mesh.face_normals[face_id]
                if not allowed(point, normal):
                    continue
                radius = rng.uniform(0.017, 0.022)
                builder.add("hair", _ellipsoid(point, [radius] * 3, subdivisions=1), PLACEHOLDER_COLOR)

    return builder.scene


def hair_filename(texture, length):
    return "hair_bald.glb" if texture == "bald" else f"hair_{texture}_{length}.glb"


def main():
    os.makedirs(COMPONENTS_DIR, exist_ok=True)
    meta = {}
    for sex in ("F", "M"):
        scene, body_meta = build_body(sex)
        path = os.path.join(COMPONENTS_DIR, f"body_{sex}.glb")
        scene.export(path, include_normals=True)
        meta[sex] = body_meta
        print("saved", path)

    for texture in TEXTURES:
        for length in (["short"] if texture == "bald" else LENGTHS):
            path = os.path.join(COMPONENTS_DIR, hair_filename(texture, length))
            build_hair(texture, length).export(path, include_normals=True)
            print("saved", path)

    with open(os.path.join(COMPONENTS_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


if __name__ == "__main__":
    main()
