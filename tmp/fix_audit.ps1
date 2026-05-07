$file = 'app\audit-logs\page.tsx'
$content = Get-Content $file -Raw -Encoding UTF8
$oldStr = "'Lead ID', getString(metadata.leadId, log.targetId || '-')"
$newStr = "'Lead', (metadata.leadId ? resolveName(getString(metadata.leadId, '')) : '-')"
$content2 = $content.Replace($oldStr, $newStr)
Set-Content $file $content2 -Encoding UTF8 -NoNewline
Write-Host "Done"
