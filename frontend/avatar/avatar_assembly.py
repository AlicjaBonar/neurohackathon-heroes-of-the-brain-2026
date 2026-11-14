import json
import os
from functools import lru_cache

import numpy as np
import trimesh
from trimesh.visual import TextureVisuals

from animations import ANIMATIONS
from generate_avatars import COMPONENTS_DIR, hair_filename, make_material
from gltf_animations import add_animations

HAIR_COLORS = {
    "blonde": "#d9b36b",
    "brown": "#5c3821",
    "black": "#141212",
    "red": "#b34d21",
    "gray": "#c7c7cc",
}


def components_version():
    return max(os.path.getmtime(os.path.join(COMPONENTS_DIR, f)) for f in os.listdir(COMPONENTS_DIR))


@lru_cache(maxsize=None)
def _load_meta(version):
    with open(os.path.join(COMPONENTS_DIR, "meta.json"), encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=64)
def _load_component(filename, version):
    return trimesh.load(os.path.join(COMPONENTS_DIR, filename), force="scene")


def _hex_to_material(hex_color):
    digits = hex_color.lstrip("#")
    srgb = tuple(int(digits[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return make_material(srgb)


def assemble_avatar(sex, texture, length, color_hex):
    version = components_version()
    meta = _load_meta(version)[sex]
    scene = _load_component(f"body_{sex}.glb", version).copy()
    hair = _load_component(hair_filename(texture, length), version)

    transform = trimesh.transformations.scale_matrix(meta["H"])
    transform[:3, 3] = meta["head"]
    material = _hex_to_material(color_hex)

    joint = meta.get("hair_joint")
    if joint and joint in scene.graph.nodes:
        joint_transform, _ = scene.graph.get(joint)
        transform = np.linalg.inv(joint_transform) @ transform
    else:
        joint = None

    for node in hair.graph.nodes_geometry:
        node_transform, geometry_name = hair.graph[node]
        mesh = hair.geometry[geometry_name].copy()
        mesh.apply_transform(transform @ node_transform)
        mesh.visual = TextureVisuals(material=material)
        scene.add_geometry(mesh, geom_name=f"hair_{node}", parent_node_name=joint)

    glb = scene.export(file_type="glb", include_normals=True)
    return add_animations(glb, {name: build() for name, build in ANIMATIONS.items()})
