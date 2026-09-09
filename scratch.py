import re

with open('D:/salesdashboard/app/globals.css', 'r', encoding='utf-8') as f:
    text = f.read()

# Insert variables into the first :root { (which is around line 43, wait, there are two :root blocks. 
# One has DESIGN TOKENS, other has LIGHT THEME. We can put it in the LIGHT THEME :root block.)
light_theme_root_regex = r'(/\* .*LIGHT THEME.* \*/\n:root \{)'
text = re.sub(light_theme_root_regex, r'\1\n  --glass-bg: rgba(0, 0, 0, 0.7);\n  --glass-bg-hover: rgba(0, 0, 0, 0.85);', text)

dark_theme_regex = r'(/\* .*ACTIVE THEME(?:.*\n)+?\.dark \{)'
text = re.sub(dark_theme_regex, r'\1\n  --glass-bg: rgba(255, 255, 255, 0.12);\n  --glass-bg-hover: rgba(255, 255, 255, 0.20);', text)

# update .glass-button
text = text.replace('background: rgba(0, 0, 0, 0.4);', 'background: var(--glass-bg, rgba(0, 0, 0, 0.7));')
text = text.replace('background: rgba(255, 255, 255, 0.04);', 'background: var(--glass-bg-hover, rgba(0, 0, 0, 0.85));')

with open('D:/salesdashboard/app/globals.css', 'w', encoding='utf-8') as f:
    f.write(text)
