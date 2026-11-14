import base64


def model_viewer_html(glb_bytes=None, src=None, height=500):
    if src is None:
        src = "data:model/gltf-binary;base64," + base64.b64encode(glb_bytes).decode("utf-8")
    return f"""<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
    <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js"></script>
    <style>
      #gestures {{ position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
                   display: flex; gap: 10px; white-space: nowrap; }}
      #gestures button {{ padding: 10px 22px; font: 600 16px sans-serif; color: #fff; background: #4a6fd1;
              border: none; border-radius: 999px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2); }}
      #gestures button:disabled {{ opacity: .6; cursor: default; }}
    </style>
    <model-viewer id="mv"
        src="{src}"
        alt="Predicted 3D avatar"
        animation-name="breathing" autoplay
        auto-rotate
        camera-controls
        interaction-prompt="none"
        shadow-intensity="1"
        camera-orbit="0deg 75deg auto"
        style="width: 100%; height: {height}px; background: radial-gradient(#ffffff, #e6e9ef); border-radius: 16px;">
      <div id="gestures">
        <button id="btn-six-seven" data-anim="six_seven">Do 67</button>
        <button id="btn-deep-breath" data-anim="deep_breath">Take a deep breath</button>
        <button id="btn-namaste" data-anim="namaste">Namaste</button>
        <button id="btn-wave" data-anim="wave">Wave</button>
      </div>
    </model-viewer>
    <script>
      const viewer = document.getElementById("mv");
      const buttons = [...document.querySelectorAll("#gestures button")];
      let playing = false, fallbackTimer = null;

      function backToBreathing() {{
        if (!playing) return;
        playing = false;
        clearTimeout(fallbackTimer);
        viewer.animationName = "breathing";
        viewer.updateComplete.then(() => viewer.play());
        viewer.autoRotate = true;
        buttons.forEach(b => b.disabled = false);
      }}

      async function playGesture(button) {{
        const name = button.dataset.anim;
        if (!viewer.availableAnimations.includes(name)) {{
          button.textContent = "Animation missing in the model - restart the app";
          return;
        }}
        playing = true;
        buttons.forEach(b => b.disabled = true);
        viewer.autoRotate = false;
        viewer.animationName = name;
        await viewer.updateComplete;
        viewer.play({{repetitions: 1}});
        fallbackTimer = setTimeout(backToBreathing, (viewer.duration + 0.8) * 1000);
      }}

      buttons.forEach(b => b.addEventListener("click", () => playGesture(b)));
      viewer.addEventListener("finished", backToBreathing);
    </script>
    </body></html>"""
