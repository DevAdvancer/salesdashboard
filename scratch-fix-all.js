const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

function fixUseServer(filePath) {
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  
  if (content.match(/['"]use server['"];?/)) {
    if (!content.startsWith('"use server"') && !content.startsWith("'use server'")) {
      content = content.replace(/['"]use server['"];?\r?\n?/g, '');
      content = '"use server";\n' + content;
      changed = true;
    }
  }
  
  if (content.match(/['"]use client['"];?/)) {
    if (!content.startsWith('"use client"') && !content.startsWith("'use client'")) {
      content = content.replace(/['"]use client['"];?\r?\n?/g, '');
      content = '"use client";\n' + content;
      changed = true;
    }
  }
  
  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log('Fixed ' + filePath);
  }
}

walkDir('app', fixUseServer);
walkDir('lib', fixUseServer);
walkDir('components', fixUseServer);
