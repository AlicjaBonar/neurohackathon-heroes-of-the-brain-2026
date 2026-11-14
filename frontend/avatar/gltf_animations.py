import json
import struct

import numpy as np

_GLB_MAGIC = 0x46546C67
_JSON_CHUNK, _BIN_CHUNK = 0x4E4F534A, 0x004E4942
_ACCESSOR_TYPES = {1: "SCALAR", 3: "VEC3", 4: "VEC4"}


def _read_glb(data):
    magic, _, _ = struct.unpack_from("<III", data, 0)
    assert magic == _GLB_MAGIC, "not a GLB file"
    offset, scene_json, binary = 12, None, b""
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8: offset + 8 + length]
        if chunk_type == _JSON_CHUNK:
            scene_json = json.loads(chunk)
        elif chunk_type == _BIN_CHUNK:
            binary = bytes(chunk)
        offset += 8 + length
    return scene_json, bytearray(binary)


def _write_glb(scene_json, binary):
    json_bytes = json.dumps(scene_json, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    return (struct.pack("<III", _GLB_MAGIC, 2, total)
            + struct.pack("<II", len(json_bytes), _JSON_CHUNK) + json_bytes
            + struct.pack("<II", len(binary), _BIN_CHUNK) + bytes(binary))


def _matrix_to_translation(node):
    if "matrix" not in node:
        return
    matrix = np.array(node.pop("matrix"), float).reshape(4, 4).T
    node["translation"] = matrix[:3, 3].tolist()
    if not np.allclose(matrix[:3, :3], np.eye(3), atol=1e-6):
        raise ValueError(f"node {node.get('name')} has a rotation or scale in its matrix, which is not supported")


def add_animations(glb, animations):
    scene_json, binary = _read_glb(glb)
    node_index = {node.get("name"): i for i, node in enumerate(scene_json["nodes"])}
    scene_json.setdefault("bufferViews", [])
    scene_json.setdefault("accessors", [])
    scene_json.setdefault("animations", [])

    def add_accessor(values, with_bounds=False):
        values = np.asarray(values, np.float32)
        components = 1 if values.ndim == 1 else values.shape[1]
        binary.extend(b"\x00" * (-len(binary) % 4))
        scene_json["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": values.nbytes})
        binary.extend(values.tobytes())
        accessor = {"bufferView": len(scene_json["bufferViews"]) - 1, "componentType": 5126,
                    "count": len(values), "type": _ACCESSOR_TYPES[components]}
        if with_bounds:
            accessor["min"] = [float(values.min())]
            accessor["max"] = [float(values.max())]
        scene_json["accessors"].append(accessor)
        return len(scene_json["accessors"]) - 1

    for name, channels in animations.items():
        animation = {"name": name, "samplers": [], "channels": []}
        for node_name, paths in channels.items():
            if node_name not in node_index:
                continue
            _matrix_to_translation(scene_json["nodes"][node_index[node_name]])
            for path, (times, values) in paths.items():
                animation["samplers"].append({"input": add_accessor(times, with_bounds=True),
                                              "output": add_accessor(values), "interpolation": "LINEAR"})
                animation["channels"].append({"sampler": len(animation["samplers"]) - 1,
                                              "target": {"node": node_index[node_name], "path": path}})
        if animation["channels"]:
            scene_json["animations"].append(animation)

    scene_json["buffers"][0]["byteLength"] = len(binary) + (-len(binary) % 4)
    return _write_glb(scene_json, binary)
