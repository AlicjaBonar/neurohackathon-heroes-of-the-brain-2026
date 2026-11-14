import streamlit as st
import streamlit.components.v1 as components

from avatar_assembly import HAIR_COLORS, assemble_avatar, components_version
from viewer_3d import model_viewer_html

st.set_page_config(page_title="fNIRS Avatar Reconstruction", layout="wide")

SEX_LABELS = {"F": "Female", "M": "Male"}
TEXTURE_LABELS = {"straight": "straight", "wavy": "wavy", "curly": "curly", "bald": "bald"}
LENGTH_LABELS = {"short": "short", "long": "long"}


@st.cache_data(show_spinner=False)
def avatar_glb(sex, texture, length, color_hex, version):
    return assemble_avatar(sex, texture, length, color_hex)


def show_model_3d(glb_bytes):
    components.html(model_viewer_html(glb_bytes), height=510)


st.title("🧠 3D body reconstruction from the fNIRS signal")

left, right = st.columns([1, 2])

with left:
    st.subheader("ML model prediction")
    st.info("Connect the output of your model here. For now you can set the parameters manually:")

    sex = st.radio("Sex", list(SEX_LABELS), format_func=SEX_LABELS.get)
    texture = st.selectbox("Hair type", list(TEXTURE_LABELS), format_func=TEXTURE_LABELS.get)
    length = st.radio("Hair length", list(LENGTH_LABELS), horizontal=True,
                      index=1 if sex == "F" else 0, key=f"length_{sex}",
                      format_func=LENGTH_LABELS.get, disabled=texture == "bald")
    color = st.selectbox("Hair color", [*HAIR_COLORS, "custom"])
    if color == "custom":
        color_hex = st.color_picker("Pick a color", "#7a4a2a")
    else:
        color_hex = HAIR_COLORS[color]

with right:
    st.subheader("3D avatar")
    show_model_3d(avatar_glb(sex, texture, length, color_hex, components_version()))
    length_info = "" if texture == "bald" else f" / `{length}`"
    st.caption(f"Assembled from components: `body_{sex}.glb` + hair `{texture}`{length_info} in color `{color_hex}`")
