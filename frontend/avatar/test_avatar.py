import os
import webbrowser

CARD_STYLE = ("text-align: center; font-family: sans-serif; background: white; padding: 15px; "
              "border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.08);")
PAGE_STYLE = ("background: #EAECEE; display: flex; justify-content: center; align-items: center; "
              "min-height: 100vh; gap: 20px; flex-wrap: wrap; padding: 20px;")


def generate_avatar_svg(sex, age, hair_color, texture, weight_kg):
    width_scale = max(0.8, min(1.5, weight_kg / 70.0))

    if age >= 65:
        color = "#D5D8DC"
    elif age >= 50:
        color = "#808B96"
    else:
        color = hair_color

    hair_back = ""
    hair_front = ""

    if texture == "bald":
        pass
    elif texture == "curly":
        hair_back = f"""
        <circle cx="150" cy="70" r="46" fill="{color}" />
        <circle cx="115" cy="80" r="22" fill="{color}" />
        <circle cx="185" cy="80" r="22" fill="{color}" />
        <circle cx="125" cy="45" r="20" fill="{color}" />
        <circle cx="175" cy="45" r="20" fill="{color}" />
        """
        if sex == "F":
            hair_back += f"""
            <circle cx="110" cy="105" r="20" fill="{color}" />
            <circle cx="190" cy="105" r="20" fill="{color}" />
            """
    elif texture == "straight":
        if sex == "F":
            hair_back = f'<rect x="108" y="45" width="84" height="105" rx="35" fill="{color}" />'
            hair_front = (f'<path d="M 112 70 Q 150 45 188 70 Q 170 55 150 62 Q 130 55 112 70 Z" '
                          f'fill="{color}" />')
        else:
            hair_front = (f'<path d="M 113 72 C 113 32, 187 32, 187 72 C 175 55, 125 55, 113 72 Z" '
                          f'fill="{color}" />')
    elif texture == "wavy":
        hair_back = (f'<path d="M 105 75 Q 100 30 150 30 Q 200 30 195 75 Q 202 105 188 125 L 112 125 '
                     f'Q 98 105 105 75 Z" fill="{color}" />')

    if sex == "F":
        body_svg = f"""
        <g transform="translate(150, 0) scale({width_scale}, 1) translate(-150, 0)">
            <rect x="130" y="240" width="14" height="95" rx="7" fill="#F5CBA7" />
            <rect x="156" y="240" width="14" height="95" rx="7" fill="#F5CBA7" />
            <rect x="126" y="330" width="20" height="10" rx="5" fill="#2C3E50" />
            <rect x="154" y="330" width="20" height="10" rx="5" fill="#2C3E50" />
            <path d="M 122 122 L 178 122 L 170 175 L 188 250 L 112 250 L 130 175 Z" fill="#E74C3C" />
            <rect x="104" y="125" width="14" height="85" rx="7" fill="#F5CBA7" transform="rotate(8 111 125)" />
            <rect x="182" y="125" width="14" height="85" rx="7" fill="#F5CBA7" transform="rotate(-8 189 125)" />
        </g>
        """
    else:
        body_svg = f"""
        <g transform="translate(150, 0) scale({width_scale}, 1) translate(-150, 0)">
            <rect x="125" y="220" width="20" height="115" rx="8" fill="#2C3E50" />
            <rect x="155" y="220" width="20" height="115" rx="8" fill="#2C3E50" />
            <rect x="122" y="330" width="24" height="10" rx="5" fill="#1A252F" />
            <rect x="154" y="330" width="24" height="10" rx="5" fill="#1A252F" />
            <rect x="115" y="120" width="70" height="108" rx="18" fill="#3498DB" />
            <rect x="96" y="124" width="16" height="90" rx="8" fill="#F5CBA7" transform="rotate(5 104 124)" />
            <rect x="188" y="124" width="16" height="90" rx="8" fill="#F5CBA7" transform="rotate(-5 196 124)" />
        </g>
        """

    wrinkles_svg = ""
    if age >= 45:
        wrinkles_svg = """
        <path d="M 126 82 Q 130 88 126 94" stroke="#C39BD3" stroke-width="1.5" fill="none" opacity="0.6" />
        <path d="M 174 82 Q 170 88 174 94" stroke="#C39BD3" stroke-width="1.5" fill="none" opacity="0.6" />
        """
    if age >= 65:
        wrinkles_svg += """
        <line x1="138" y1="52" x2="162" y2="52" stroke="#B08D70" stroke-width="1.2" opacity="0.5" />
        """

    svg = f"""
    <svg width="260" height="320" viewBox="0 0 300 360" xmlns="http://www.w3.org/2000/svg" style="background: #F8F9F9; border-radius: 16px; border: 1px solid #E5E8E8;">
        {hair_back}

        {body_svg}

        <rect x="140" y="102" width="20" height="24" rx="6" fill="#E6B88A" />

        <circle cx="150" cy="76" r="35" fill="#F5CBA7" />

        <circle cx="138" cy="74" r="3.5" fill="#2C3E50" />
        <circle cx="162" cy="74" r="3.5" fill="#2C3E50" />
        <path d="M 141 90 Q 150 98 159 90" stroke="#A04000" stroke-width="2.5" fill="none" stroke-linecap="round" />

        {wrinkles_svg}

        {hair_front}

        <rect x="116" y="56" width="68" height="9" rx="3" fill="#2C3E50" opacity="0.85" />
        <circle cx="130" cy="60.5" r="2.5" fill="#E74C3C" />
        <circle cx="150" cy="60.5" r="2.5" fill="#2ECC71" />
        <circle cx="170" cy="60.5" r="2.5" fill="#E74C3C" />
    </svg>
    """
    return svg


if __name__ == "__main__":
    examples = [
        {"caption": "Woman, 24 years, 52 kg, blonde, straight", "data": ("F", 24, "#F1C40F", "straight", 52)},
        {"caption": "Man, 35 years, 98 kg, brown, curly", "data": ("M", 35, "#5D4037", "curly", 98)},
        {"caption": "Woman, 68 years, 75 kg, gray, wavy", "data": ("F", 68, "#3B2314", "wavy", 75)},
        {"caption": "Man, 55 years, 62 kg, bald", "data": ("M", 55, "#000000", "bald", 62)},
    ]

    cards_html = ""
    for example in examples:
        svg_code = generate_avatar_svg(*example["data"])
        cards_html += f"""
        <div style="{CARD_STYLE}">
            {svg_code}
            <p style="margin-top: 10px; font-size: 14px; color: #333; font-weight: bold;">{example['caption']}</p>
        </div>
        """

    page_html = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><title>fNIRS Avatar Preview</title></head>
    <body style="{PAGE_STYLE}">
        {cards_html}
    </body>
    </html>
    """

    output_path = os.path.abspath("avatar_preview.html")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(page_html)

    print(f"Preview generated: {output_path}")
    webbrowser.open(f"file://{output_path}")
