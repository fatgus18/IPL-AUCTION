<#
Read a trusted-location XLSX as data only; formulas, macros and links are never executed.
Usage: powershell -NoProfile -File scripts/import-player-workbook.ps1 -WorkbookPath 'C:/path/IPL MOCK AUCTION.xlsx'
The import intentionally ignores historical sale results and imports every listed player,
including rows where TO BE SOLD is zero. Countries, photos and career statistics are not
present in this workbook, and are left null rather than guessed.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$WorkbookPath,
    [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '../data' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$workbookFile = Get-Item -LiteralPath $WorkbookPath
if ($workbookFile.Extension -ne '.xlsx') { throw 'Expected an .xlsx workbook, not a single-sheet CSV export.' }
$archive = [IO.Compression.ZipFile]::OpenRead($workbookFile.FullName)

function Read-WorkbookXml([string]$Name) {
    $entry = $archive.GetEntry($Name)
    if ($null -eq $entry) { return $null }
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $stream = $entry.Open()
    $reader = [Xml.XmlReader]::Create($stream, $settings)
    try {
        $document = [Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    } finally { $reader.Dispose(); $stream.Dispose() }
}

function Read-CellText($Cell) {
    if ($Cell.t -eq 's') { return [string]$script:sharedStrings[[int]$Cell.v] }
    if ($Cell.t -eq 'inlineStr') { return [string]$Cell.is.InnerText }
    return [string]$Cell.v
}

function Normalize-Name([string]$Name) {
    $clean = ($Name -replace '\s*\(WK\)\s*$', '').Trim() -replace '\s+', ' '
    $key = $clean.ToUpperInvariant()
    if ($nameCorrections.ContainsKey($key)) { return $nameCorrections[$key].name }
    $display = [Globalization.CultureInfo]::InvariantCulture.TextInfo.ToTitleCase($clean.ToLowerInvariant())
    $display = $display -replace '^Kl ', 'KL ' -replace '^Ms ', 'MS ' -replace ' De Kock$', ' de Kock'
    return $display
}

function Parse-BasePrice([string]$Text) {
    $normalized = $Text.Trim().ToUpperInvariant() -replace '\s+', ''
    if ($normalized -notmatch '^(\d+(?:\.\d+)?)(CR|CRORE|CRORES|L|LAKH|LAKHS)$') {
        throw "Unrecognized base price '$Text'; refusing to invent a price."
    }
    $amount = [decimal]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture)
    if ($Matches[2] -in @('CR', 'CRORE', 'CRORES')) { $amount *= 100 }
    if ($amount -ne [math]::Truncate($amount) -or $amount -lt 1) { throw "Base price '$Text' is not a positive whole number of lakhs." }
    return [int]$amount
}

function Resolve-PlayingRole([string]$Text) {
    switch -Regex ($Text.ToUpperInvariant()) {
        'WICKET|\(WK\)' { return 'Wicketkeeper' }
        'ALL[ -]?ROUND' { return 'All-rounder' }
        'BATTER' { return 'Batter' }
        'BOWLER' { return 'Bowler' }
        default { return $null }
    }
}

# Only unambiguous corrections supported by primary cricket organizations are applied.
# All original text remains available in sourceRows and the audit report.
$nameCorrections = @{
    'YAHASVI JAISWAL' = @{ name = 'Yashasvi Jaiswal'; sourceUrl = 'https://www.rajasthanroyals.com/rr-players/yashasvi-jaiswal-ipl-profile-69238' }
    'NUWAV THUSHARA' = @{ name = 'Nuwan Thushara'; sourceUrl = 'https://www.royalchallengers.com/rcb-cricket-news/news/rcb-rope-in-richard-gleeson-as-nuwan-thusharas-replacement-for-ipl-2026' }
    'LHUAN-DRE PRETORIOUS' = @{ name = 'Lhuan-dre Pretorius'; sourceUrl = 'https://www.paarlroyals.com/squad/109249-lhuan-dre-pretorius' }
    'TRIPURNA VIJAY' = @{ name = 'Tripurana Vijay'; sourceUrl = 'https://www.bcci.tv/players/8872b99d-3648-418f-884d-87f0bc01193a/tripurana-vijay/videos' }
}
$reviewNotesByName = @{
    'AKSHAT RAGHUVANSHI' = 'Preserved as supplied. A distinct player from Angkrish Raghuvanshi; confirmed in the official IPL 2026 auction list.'
    'AJAY JADAV' = 'Abbreviated name preserved as supplied. Cricbuzz lists the full name Ajay Jadav Mandal.'
    'MOHAMMED SALAHUDDIN IZHAR' = 'Full name preserved as supplied and confirmed by the Cricbuzz profile.'
}
$identityEvidence = @{
    'akshat-raghuvanshi' = 'https://documents.iplt20.com/bcci/documents/1765284319912_TATA%20IPL%202026%20-%20Auction%20List%20-%209.12.25.pdf'
    'ajay-jadav' = 'https://www.cricbuzz.com/profiles/11777/ajay-jadav-mandal'
    'mohammed-salahuddin-izhar' = 'https://www.cricbuzz.com/profiles/1465841/mohammed-salahuddin-izhar'
}

# Disambiguated by reading each provider profile's country, birth date, playing role,
# IPL career and team affiliations. These are external identity links, NOT workbook data.
# Retaining the workbook name makes original-name searches and the audit reproducible.
$verifiedProfiles = @{
    'rashid-khan' = @('10738/rashid-khan', 'Afghanistan international and Gujarat Titans player; distinct from Pakistan and Nepal namesakes.')
    'abhishek-sharma' = @('12086/abhishek-sharma', 'Sunrisers Hyderabad all-rounder born 4 September 2000; distinct from the Railways batter.')
    'varun-chakravarthy' = @('12926/varun-chakaravarthy', 'Provider spelling Chakaravarthy; KKR spinner born 29 August 1991, also verified on BCCI profile.')
    'rohit-sharma' = @('576/rohit-sharma', 'India and Mumbai Indians batter born 30 April 1987; distinct from other namesakes.')
    'mukesh-kumar' = @('10754/mukesh-kumar', 'Bengal and Delhi Capitals bowler born 12 October 1993.')
    'mayank-yadav' = @('22401/mayank-yadav', 'Delhi and Lucknow Super Giants fast bowler born 17 June 2002.')
    'allah-ghazanfar' = @('36501/am-ghazanfar', 'Provider abbreviation AM Ghazanfar; Afghanistan off-spinner born 20 March 2006, verified by ICC full-name biography.')
    'shubham-dubey' = @('19328/shubham-dubey', 'Rajasthan Royals batter born 27 August 1994, with IPL batting appearances.')
    'abdul-samad' = @('14628/abdul-samad', 'Jammu and Kashmir, SRH and LSG batter born 28 October 2001; distinct from overseas namesakes.')
    'akshat-raghuvanshi' = @('24431/akshat-raghuwanshi', 'Provider spelling Raghuwanshi; Madhya Pradesh and LSG batter born 15 September 2003 matches official auction list.')
    'abhishek-porel' = @('24326/abishek-porel', 'Provider spelling Abishek; Bengal and Delhi Capitals wicketkeeper born 17 October 2002.')
    'shashank-singh' = @('10919/shashank-singh', 'Punjab Kings batter born 21 November 1991; distinct from younger namesake.')
    'vaibhav-suryavanshi' = @('51791/vaibhav-sooryavanshi', 'Provider spelling Sooryavanshi; Rajasthan Royals batter born 27 March 2011, also verified by Cricket Australia profile.')
    'rasikh-dar-salam' = @('14274/rasikh-salam-dar', 'Provider name order Salam Dar; Jammu and Kashmir and RCB bowler born 5 April 2000.')
    'prince-yadav' = @('54735/prince-yadav', 'Delhi and Lucknow Super Giants fast bowler, distinct from same-name older domestic player.')
    'mohsin-khan' = @('13534/mohsin-khan', 'Uttar Pradesh and LSG left-arm bowler born 15 July 1998; distinct from Pakistan, Hong Kong and younger India namesakes.')
    'onkar-tukaram-tarmale' = @('1453784/onkar-tarmale', 'Provider shorter name Onkar Tarmale; Mumbai and Sunrisers Hyderabad player.')
    'amit-kumar' = @('1466014/amit-kumar', 'Jharkhand and Sunrisers Hyderabad player born 2 November 2002; distinct from older India and Bangladesh namesakes.')
    'yash-raj-punia' = @('1458811/yash-raj-punja', 'Provider spelling Punja; Hubli Tigers and Rajasthan Royals leg-spinner born 26 June 2006.')
    'r-sai-kishore' = @('11595/ravisrinivasan-sai-kishore', 'Expanded given name Ravisrinivasan; Tamil Nadu and Gujarat Titans left-arm spinner.')
    'sandeep-sharma' = @('8356/sandeep-sharma', 'Punjab and Rajasthan Royals bowler born 18 May 1993; distinct from domestic namesake.')
    'digvesh-rathi' = @('1448289/digvesh-singh-rathi', 'Provider full name Digvesh Singh Rathi; Delhi and Lucknow Super Giants spinner born 15 December 1999.')
    'arshad-khan' = @('18637/arshad-khan', 'Madhya Pradesh and Gujarat Titans all-rounder born 20 December 1997; distinct from retired Pakistan namesake.')
    'ajay-jadav' = @('11777/ajay-jadav-mandal', 'Expanded surname Mandal; Chhattisgarh and Delhi Capitals all-rounder born 25 February 1996.')
    'akash-singh' = @('14696/akash-maharaj-singh', 'Expanded name Akash Maharaj Singh; Rajasthan, CSK and LSG bowler born 26 April 2002, distinct from the same-name batter born 20 December 1995.')
}

$players = [Collections.Generic.List[object]]::new()
$byIdentity = @{}
$sheetReports = [Collections.Generic.List[object]]::new()
$excludedRows = [Collections.Generic.List[object]]::new()
$corrections = [Collections.Generic.List[object]]::new()
$duplicates = [Collections.Generic.List[object]]::new()
$unresolvedRows = [Collections.Generic.List[object]]::new()
$formulaCells = [Collections.Generic.List[object]]::new()
$includedRows = 0

try {
    $workbookXml = Read-WorkbookXml 'xl/workbook.xml'
    $relationships = Read-WorkbookXml 'xl/_rels/workbook.xml.rels'
    $stringsXml = Read-WorkbookXml 'xl/sharedStrings.xml'
    $script:sharedStrings = @($stringsXml.sst.si | ForEach-Object { $_.InnerText })
    foreach ($sheet in $workbookXml.workbook.sheets.sheet) {
        $sheetName = [string]$sheet.name
        $normalizedSheet = $sheetName.Trim().ToUpperInvariant()
        if ($normalizedSheet -in @('THE TEAMS', 'POINTS')) {
            $sheetReports.Add([ordered]@{ sheet = $sheetName; state = [string]$sheet.state; status = 'excluded_by_request'; playerRows = 0; reason = 'Excluded by user instruction; sheet contents not read.' })
            continue
        }
        $relationship = $relationships.Relationships.Relationship | Where-Object { $_.Id -eq $sheet.id }
        if ($null -eq $relationship) { throw "Missing worksheet relationship for '$sheetName'." }
        $target = [string]$relationship.Target
        if ($target.StartsWith('/')) { $entryName = $target.TrimStart('/') } else { $entryName = 'xl/' + $target }
        $worksheet = Read-WorkbookXml $entryName
        if ($null -eq $worksheet) { throw "Worksheet '$sheetName' is missing." }
        $headers = @{}
        $headerRow = $null
        $rowCount = 0
        $nonPlayerCount = 0
        foreach ($row in $worksheet.worksheet.sheetData.row) {
            $values = @{}
            foreach ($cell in $row.c) {
                $text = Read-CellText $cell
                if ($text.Trim().Length -gt 0) { $values[([string]$cell.r -replace '\d', '')] = $text }
                if ($null -ne $cell.f) { $formulaCells.Add([ordered]@{ sheet = $sheetName; cell = [string]$cell.r; action = 'Formula not evaluated; cached cell value only.' }) }
            }
            if ($values.Count -eq 0) { continue }
            if ($values.Values -contains 'PLAYER NAME') {
                foreach ($column in $values.Keys) { $headers[$values[$column].Trim().ToUpperInvariant()] = $column }
                $headerRow = [int]$row.r
                $excludedRows.Add([ordered]@{ sheet = $sheetName; row = [int]$row.r; reason = 'player_list_header' })
                continue
            }
            if ($null -eq $headerRow) {
                $nonPlayerCount++
                $excludedRows.Add([ordered]@{ sheet = $sheetName; row = [int]$row.r; reason = 'non_player_row'; cells = $values })
                continue
            }
            $nameColumn = $headers['PLAYER NAME']
            $priceColumn = $headers['BASE PRICE']
            if (-not $values.ContainsKey($nameColumn)) {
                $unresolvedRows.Add([ordered]@{ sheet = $sheetName; row = [int]$row.r; reason = 'Non-empty player-list row without a name'; cells = $values })
                continue
            }
            $originalName = [string]$values[$nameColumn]
            $originalPrice = [string]$values[$priceColumn]
            $originalRole = if ($headers.ContainsKey('ROLE')) { [string]$values[$headers['ROLE']] } else { $null }
            $playingRole = Resolve-PlayingRole (($originalRole, $originalName, $sheetName) -join ' ')
            if ($null -eq $playingRole) { throw "Unrecognized role in '$sheetName' row $($row.r)." }
            $role = if ($normalizedSheet -eq 'MARQUEE SET') { 'Marquee' } else { $playingRole }
            $name = Normalize-Name $originalName
            $id = ($name.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
            $basePrice = Parse-BasePrice $originalPrice
            $profileUrl = if ($verifiedProfiles.ContainsKey($id)) { 'https://www.cricbuzz.com/profiles/' + $verifiedProfiles[$id][0] } else { $null }
            $profileUrlSource = if ($null -ne $profileUrl) { 'externally_verified_identity' } else { $null }
            $sourceRow = [ordered]@{ sheet = $sheetName; row = [int]$row.r; originalName = $originalName; originalRole = $originalRole; originalBasePrice = $originalPrice }
            $nameKey = (($originalName -replace '\s*\(WK\)\s*$', '').Trim() -replace '\s+', ' ').ToUpperInvariant()
            $notes = @()
            if ($reviewNotesByName.ContainsKey($nameKey)) { $notes += $reviewNotesByName[$nameKey] }
            if ($nameCorrections.ContainsKey($nameKey)) {
                $corrections.Add([ordered]@{ sheet = $sheetName; row = [int]$row.r; originalName = $originalName; name = $name; sourceUrl = $nameCorrections[$nameKey].sourceUrl; reason = 'Unambiguous spelling correction verified against a primary cricket organization.' })
            }
            if ($byIdentity.ContainsKey($id)) {
                $existing = $byIdentity[$id]
                if ($existing.basePrice -ne $basePrice -or $existing.playingRole -ne $playingRole) { throw "Conflicting duplicate '$name' in '$sheetName' row $($row.r); resolve explicitly before importing." }
                $existing.sourceRows += $sourceRow
                $duplicates.Add([ordered]@{ id = $id; sheet = $sheetName; row = [int]$row.r; reason = 'Exact normalized name, playing role and base price match.' })
            } else {
                $player = [ordered]@{
                    id = $id; name = $name; role = $role; playingRole = $playingRole
                    country = $null; basePrice = $basePrice; basePriceSource = 'workbook'
                    profileUrl = $profileUrl; profileUrlSource = $profileUrlSource; image = $null; stats = $null
                    sourceRows = @($sourceRow); reviewNotes = @($notes)
                }
                $players.Add($player)
                $byIdentity[$id] = $player
            }
            $rowCount++
            $includedRows++
        }
        $status = if ($rowCount -gt 0) { 'imported' } else { 'no_player_list' }
        $sheetReports.Add([ordered]@{ sheet = $sheetName; state = [string]$sheet.state; status = $status; headerRow = $headerRow; playerRows = $rowCount; nonPlayerRows = $nonPlayerCount })
    }
} finally { $archive.Dispose() }

if ($unresolvedRows.Count -gt 0) { throw "Found $($unresolvedRows.Count) unresolved rows. No catalog was written: $($unresolvedRows | ConvertTo-Json -Depth 8 -Compress)" }
if ($players.Count -eq 0) { throw 'No player rows found. No catalog was written.' }
$source = [ordered]@{ fileName = $workbookFile.Name; sha256 = (Get-FileHash -LiteralPath $workbookFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
$catalog = [ordered]@{ version = 1; source = $source; players = @($players.ToArray()) }
$report = [ordered]@{
    version = 1; source = $source
    counts = [ordered]@{ worksheets = $sheetReports.Count; playerSheets = @($sheetReports | Where-Object { $_.status -eq 'imported' }).Count; sourcePlayerRows = $includedRows; uniquePlayers = $players.Count; duplicatesMerged = $duplicates.Count; unresolvedRows = $unresolvedRows.Count; nameCorrections = $corrections.Count; countryMissing = $players.Count; statisticsMissing = $players.Count; photoMissing = $players.Count; externallyVerifiedProfileLinks = $verifiedProfiles.Count; defaultsApplied = 0 }
    policy = @(
        'THE TEAMS and POINTS contents were not read.'
        'All player rows are included, including hidden rows and TO BE SOLD = 0.'
        'Historical SOLD PRICE, SOLD TO and TO BE SOLD fields are not imported into the new auction.'
        'No formulas, external links, macros or spreadsheet commands are executed.'
        'Country, image and statistics are absent in the source and left null.'
        'Only explicit workbook base prices are used; all values are integer lakhs.'
        'MARQUEE SET remains the auction role Marquee; playingRole preserves its explicit ROLE column.'
        'An explicit (WK) name suffix overrides a BATTERS sheet role, while the source row is preserved.'
        'Names are case/whitespace normalized; only the listed primary-source corrections alter spelling.'
        'Externally verified profile links resolve provider spelling variants and namesakes; they are audited separately from workbook fields.'
        'Rules are audited as non-player rows; they do not silently change app settings.'
    )
    sheets = @($sheetReports.ToArray()); excludedRows = @($excludedRows.ToArray()); aliases = @($corrections.ToArray()); duplicates = @($duplicates.ToArray()); unresolvedRows = @($unresolvedRows.ToArray()); formulaCells = @($formulaCells.ToArray())
    identityReview = @($players | Where-Object { $_.reviewNotes.Count -gt 0 } | ForEach-Object { [ordered]@{ id = $_.id; name = $_.name; notes = $_.reviewNotes; sourceUrl = $identityEvidence[$_.id]; sourceRows = $_.sourceRows } })
    verifiedProfileLinks = @($players | Where-Object { $null -ne $_.profileUrl } | ForEach-Object { [ordered]@{ id = $_.id; name = $_.name; profileUrl = $_.profileUrl; source = $_.profileUrlSource; reason = $verifiedProfiles[$_.id][1] } })
}
$directory = [IO.Path]::GetFullPath($OutputDirectory)
[void][IO.Directory]::CreateDirectory($directory)
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $directory 'player-catalog.json'), ($catalog | ConvertTo-Json -Depth 14) + [Environment]::NewLine, $utf8)
[IO.File]::WriteAllText((Join-Path $directory 'player-catalog-report.json'), ($report | ConvertTo-Json -Depth 14) + [Environment]::NewLine, $utf8)
Write-Output "Imported $($players.Count) unique players from $($report.counts.playerSheets) player lists ($includedRows source rows)."
Write-Output ($report.counts | ConvertTo-Json -Compress)
