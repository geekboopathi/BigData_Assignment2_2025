const express = require('express');
const formidable = require('formidable');
const fs = require('fs/promises');
const app = express();
const PORT = 3000;

const Timer = require('./Timer');
const CloneDetector = require('./CloneDetector');
const CloneStorage = require('./CloneStorage');
const FileStorage = require('./FileStorage');


// ==============================
// NEW: simple in-memory stats log
// ==============================
const processingStats = []; // { when, name, lines, chunks, timers: {total, match, ...}, msPerKLOC }
const MAX_STATS = 5000;     // keep memory bounded

function bigintNsToMs(bi) {
    try { return Number(bi) / 1e6; } catch { return 0; }
}

function recordStats(file) {
    const timers = Timer.getTimers(file) || {};
    const totalMs = bigintNsToMs(timers.total ?? 0n);
    const matchMs = bigintNsToMs(timers.match ?? 0n);

    const lines = (file.lines || []).length;        // still available before prune
    const chunks = (file.chunks || []).length || 0; // may be 0 if small file
    const kloc = Math.max(lines / 1000, 0.001);     // avoid div-by-zero
    const msPerKLOC = Math.round((totalMs / kloc) * 100) / 100;

    processingStats.push({
        when: new Date().toISOString(),
        name: file.name,
        lines,
        chunks,
        timers: Object.fromEntries(
            Object.entries(timers).map(([k, v]) => [k, bigintNsToMs(v)])
        ),
        msPerKLOC
    });

    if (processingStats.length > MAX_STATS) processingStats.shift();
}

function averageOfLast(key, n) {
    const slice = processingStats.slice(-n);
    if (slice.length === 0) return 0;
    const sum = slice.reduce((acc, s) => acc + (s.timers[key] || 0), 0);
    return Math.round((sum / slice.length) * 100) / 100;
}

function overallAverage(key) {
    if (processingStats.length === 0) return 0;
    const sum = processingStats.reduce((acc, s) => acc + (s.timers[key] || 0), 0);
    return Math.round((sum / processingStats.length) * 100) / 100;
}


// Express and Formidable stuff to receice a file for further processing
// --------------------
const form = formidable({multiples:false});

app.post('/', fileReceiver );
function fileReceiver(req, res, next) {
    form.parse(req, (err, fields, files) => {
        fs.readFile(files.data.filepath, { encoding: 'utf8' })
            .then( data => { return processFile(fields.name, data); });
    });
    return res.end('');
}

app.get('/', viewClones );

// ==============================
// NEW: timers/statistics routes
// ==============================
app.get('/timers.json', (req, res) => {
    res.json({
        count: processingStats.length,
        averages: {
            overall: {
                totalMs: overallAverage('total'),
                matchMs: overallAverage('match')
            },
            last100: {
                totalMs: averageOfLast('total', 100),
                matchMs: averageOfLast('match', 100)
            },
            last1000: {
                totalMs: averageOfLast('total', 1000),
                matchMs: averageOfLast('match', 1000)
            }
        },
        stats: processingStats
    });
});

app.get('/timers', (req, res) => {
    const rows = processingStats.map(s => `
        <tr>
            <td>${s.when}</td>
            <td title="${s.name}">${s.name.split(/[\\/]/).pop()}</td>
            <td class="r">${s.lines}</td>
            <td class="r">${s.chunks}</td>
            <td class="r">${(s.timers.total ?? 0).toFixed(2)}</td>
            <td class="r">${(s.timers.match ?? 0).toFixed(2)}</td>
            <td class="r">${s.msPerKLOC.toFixed(2)}</td>
        </tr>
    `).join('');

    const html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>CodeStream – Timers</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;}
        table{border-collapse:collapse;width:100%;}
        th,td{border:1px solid #ddd;padding:8px;}
        th{background:#f6f6f6;text-align:left;}
        tr:nth-child(even){background:#fafafa;}
        .r{text-align:right;}
        .cards{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;}
        .card{border:1px solid #ddd;border-radius:10px;padding:12px;min-width:220px;}
        .muted{color:#666;font-size:0.9em;}
      </style>
    </head>
    <body>
      <h1>Processing Timers</h1>
      <div class="cards">
        <div class="card">
          <div class="muted">Overall avg</div>
          <div>Total: <b>${overallAverage('total').toFixed(2)} ms</b></div>
          <div>Match: <b>${overallAverage('match').toFixed(2)} ms</b></div>
        </div>
        <div class="card">
          <div class="muted">Last 100</div>
          <div>Total: <b>${averageOfLast('total',100).toFixed(2)} ms</b></div>
          <div>Match: <b>${averageOfLast('match',100).toFixed(2)} ms</b></div>
        </div>
        <div class="card">
          <div class="muted">Last 1000</div>
          <div>Total: <b>${averageOfLast('total',1000).toFixed(2)} ms</b></div>
          <div>Match: <b>${averageOfLast('match',1000).toFixed(2)} ms</b></div>
        </div>
        <div class="card">
          <div class="muted">Count</div>
          <div><b>${processingStats.length}</b> files</div>
        </div>
      </div>

      <p class="muted">Normalized time = Total ms per KLOC (1 KLOC = 1,000 lines).</p>

      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>File</th>
            <th class="r">Lines</th>
            <th class="r">Chunks</th>
            <th class="r">Total (ms)</th>
            <th class="r">Match (ms)</th>
            <th class="r">ms / KLOC</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p><a href="/timers.json">Raw JSON</a> • <a href="/">Back to Home</a></p>
    </body>
    </html>`;
    res.type('html').send(html);
});

const server = app.listen(PORT, () => { console.log('Listening for files on port', PORT); });


// Page generation for viewing current progress
// --------------------
function getStatistics() {
    let cloneStore = CloneStorage.getInstance();
    let fileStore = FileStorage.getInstance();
    let output = 'Processed ' + fileStore.numberOfFiles + ' files containing ' + cloneStore.numberOfClones + ' clones.'
    return output;
}

function lastFileTimersHTML() {
    if (!lastFile) return '';
    output = '<p>Timers for last file processed:</p>\n<ul>\n'
    let timers = Timer.getTimers(lastFile);
    for (t in timers) {
        output += '<li>' + t + ': ' + (timers[t] / (1000n)) + ' µs\n'
    }
    output += '</ul>\n';
    return output;
}

function listClonesHTML() {
    let cloneStore = CloneStorage.getInstance();
    let output = '';

    cloneStore.clones.forEach( clone => {
        output += '<hr>\n';
        output += '<h2>Source File: ' + clone.sourceName + '</h2>\n';
        output += '<p>Starting at line: ' + clone.sourceStart + ' , ending at line: ' + clone.sourceEnd + '</p>\n';
        output += '<ul>';
        clone.targets.forEach( target => {
            output += '<li>Found in ' + target.name + ' starting at line ' + target.startLine + '\n';            
        });
        output += '</ul>\n'
        output += '<h3>Contents:</h3>\n<pre><code>\n';
        output += clone.originalCode;
        output += '</code></pre>\n';
    });

    return output;
}

function listProcessedFilesHTML() {
    let fs = FileStorage.getInstance();
    let output = '<HR>\n<H2>Processed Files</H2>\n'
    output += fs.filenames.reduce( (out, name) => {
        out += '<li>' + name + '\n';
        return out;
    }, '<ul>\n');
    output += '</ul>\n';
    return output;
}

function viewClones(req, res, next) {
    let page='<HTML><HEAD><TITLE>CodeStream Clone Detector</TITLE></HEAD>\n';
    page += '<BODY><H1>CodeStream Clone Detector</H1>\n';
    page += '<P>' + getStatistics() + '</P>\n';
    page += '<P>See detailed timing trends at <a href="/timers">/timers</a>.</P>\n';
    page += lastFileTimersHTML() + '\n';
    page += listClonesHTML() + '\n';
    page += listProcessedFilesHTML() + '\n';
    page += '</BODY></HTML>';
    res.send(page);
}

// Some helper functions
// --------------------
// PASS is used to insert functions in a Promise stream and pass on all input parameters untouched.
PASS = fn => d => {
    try {
        fn(d);
        return d;
    } catch (e) {
        throw e;
    }
};

const STATS_FREQ = 100;
const URL = process.env.URL || 'http://localhost:8080/';
var lastFile = null;

function maybePrintStatistics(file, cloneDetector, cloneStore) {
    if (0 == cloneDetector.numberOfProcessedFiles % STATS_FREQ) {
        console.log('Processed', cloneDetector.numberOfProcessedFiles, 'files and found', cloneStore.numberOfClones, 'clones.');
        let timers = Timer.getTimers(file);
        let str = 'Timers for last file processed: ';
        for (t in timers) {
            str += t + ': ' + (timers[t] / (1000n)) + ' µs '
        }
        console.log(str);
        console.log('List of found clones available at', URL);
        console.log('Detailed timing stats available at', URL + 'timers');
    }

    return file;
}

// Processing of the file
// --------------------
function processFile(filename, contents) {
    let cd = new CloneDetector();
    let cloneStore = CloneStorage.getInstance();

    return Promise.resolve({name: filename, contents: contents} )
        //.then( PASS( (file) => console.log('Processing file:', file.name) ))
        .then( (file) => Timer.startTimer(file, 'total') )
        .then( (file) => cd.preprocess(file) )
        .then( (file) => cd.transform(file) )

        .then( (file) => Timer.startTimer(file, 'match') )
        .then( (file) => cd.matchDetect(file) )
        .then( (file) => cloneStore.storeClones(file) )
        .then( (file) => Timer.endTimer(file, 'match') )

        // NEW: record stats BEFORE pruning (so we still have file.lines)
        .then( PASS( (file) => recordStats(file) ) )

        .then( (file) => cd.storeFile(file) )
        .then( (file) => Timer.endTimer(file, 'total') )
        .then( PASS( (file) => lastFile = file ))
        .then( PASS( (file) => maybePrintStatistics(file, cd, cloneStore) ))
        .catch( console.log );
};

/*
1. Preprocessing: Remove uninteresting code, determine source and comparison units/granularities
2. Transformation: One or more extraction and/or transformation techniques are applied to the preprocessed code to obtain an intermediate representation of the code.
3. Match Detection: Transformed units (and/or metrics for those units) are compared to find similar source units.
4. Formatting: Locations of identified clones in the transformed units are mapped to the original code base by file location and line number.
5. Post-Processing and Filtering: Visualisation of clones and manual analysis to filter out false positives
6. Aggregation: Clone pairs are aggregated to form clone classes or families, in order to reduce the amount of data and facilitate analysis.
*/
