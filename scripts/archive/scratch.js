const fs = require('fs');
let text = fs.readFileSync('D:/salesdashboard/app/globals.css', 'utf-8');

// I will just use split and join to safely replace without regex issues
text = text.replace(':root {\n  --background:            var(--canvas);', ':root {\n  --glass-bg: rgba(0, 0, 0, 0.7);\n  --glass-bg-hover: rgba(0, 0, 0, 0.85);\n  --background:            var(--canvas);');

text = text.replace('.dark {\n  --ink:            #ffffff;', '.dark {\n  --glass-bg: rgba(255, 255, 255, 0.12);\n  --glass-bg-hover: rgba(255, 255, 255, 0.20);\n  --ink:            #ffffff;');

// Just in case it wasn't replaced before (it seems it was, but this is safe)
text = text.replace('background: rgba(0, 0, 0, 0.4);', 'background: var(--glass-bg, rgba(0, 0, 0, 0.7));');
text = text.replace('background: rgba(255, 255, 255, 0.04);', 'background: var(--glass-bg-hover, rgba(0, 0, 0, 0.85));');

fs.writeFileSync('D:/salesdashboard/app/globals.css', text, 'utf-8');
