const emptyLine = /^\s*$/;
const oneLineComment = /\/\/.*/;
const oneLineMultiLineComment = /\/\*.*?\*\//; 
const openMultiLineComment = /\/\*+[^\*\/]*$/;
const closeMultiLineComment = /^[\*\/]*\*+\//;

const SourceLine = require('./SourceLine');
const FileStorage = require('./FileStorage');
const Clone = require('./Clone');

const DEFAULT_CHUNKSIZE = 5;

class CloneDetector {
  #myChunkSize = process.env.CHUNKSIZE || DEFAULT_CHUNKSIZE;
  #myFileStore = FileStorage.getInstance();

  // --------------------
  // Private helpers
  // --------------------
  #filterLines(file) {
    // Split robustly on CRLF or LF
    const lines = file.contents.split(/\r?\n/);
    let inMultiLineComment = false;
    file.lines = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (inMultiLineComment) {
        if (line.search(closeMultiLineComment) !== -1) {
          line = line.replace(closeMultiLineComment, '');
          inMultiLineComment = false;
        } else {
          line = '';
        }
      }

      // Remove inline /* ... */ first, then //, then pure empty
      line = line.replace(oneLineMultiLineComment, '');
      line = line.replace(oneLineComment, '');
      line = line.replace(emptyLine, '');

      if (line.search(openMultiLineComment) !== -1) {
        line = line.replace(openMultiLineComment, '');
        inMultiLineComment = true;
      }

      file.lines.push(new SourceLine(i + 1, line.trim()));
    }
    return file;
  }

  #getContentLines(file) {
    return file.lines.filter(l => l.hasContent());
  }

  #chunkify(file) {
    const chunkSize = Number(this.#myChunkSize);
    const lines = this.#getContentLines(file);
    file.chunks = [];

    for (let i = 0; i <= lines.length - chunkSize; i++) {
      const chunk = lines.slice(i, i + chunkSize);
      file.chunks.push(chunk);
    }
    return file;
  }

  #chunkMatch(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!a[i].equals(b[i])) return false;
    }
    return true;
  }

  // Rebuild chunks for a stored/pruned file if needed using its contents
  #ensureChunksForCompare(compareFile) {
    if (compareFile && Array.isArray(compareFile.chunks) && compareFile.chunks.length) {
      return compareFile;
    }
    if (!compareFile?.contents) return compareFile; // cannot rebuild
    const tmp = { name: compareFile.name, contents: compareFile.contents };
    this.#filterLines(tmp);
    this.#chunkify(tmp);
    return { ...compareFile, chunks: tmp.chunks };
  }

  #filterCloneCandidates(file, compareFile) {
    file.instances = file.instances || [];
    const newInstances = [];

    const cf = this.#ensureChunksForCompare(compareFile);
    if (!file.chunks || !cf?.chunks) return file;

    for (let i = 0; i < file.chunks.length; i++) {
      const aChunk = file.chunks[i];
      for (let j = 0; j < cf.chunks.length; j++) {
        const bChunk = cf.chunks[j];
        if (this.#chunkMatch(aChunk, bChunk)) {
          // Your Clone signature: (sourceName, targetName, sourceChunk, targetChunk)
          const cand = new Clone(file.name, cf.name, aChunk, bChunk);
          newInstances.push(cand);
        }
      }
    }

    file.instances = file.instances.concat(newInstances);
    return file;
  }

  #expandCloneCandidates(file) {
    // Use Clone::maybeExpandWith() as provided
    const expanded = [];
    for (const cand of (file.instances || [])) {
      let merged = false;
      for (let k = 0; k < expanded.length; k++) {
        if (expanded[k].maybeExpandWith(cand)) {
          merged = true;
          break;
        }
      }
      if (!merged) expanded.push(cand);
    }
    file.instances = expanded;
    return file;
  }

  #consolidateClones(file) {
    // Unique roots by Clone::equals; merge duplicates via addTarget()
    const unique = (file.instances || []).reduce((acc, curr) => {
      const hit = acc.find(x => x.equals(curr));
      if (hit) hit.addTarget(curr);
      else acc.push(curr);
      return acc;
    }, []);
    file.instances = unique;
    return file;
  }

  // --------------------
  // Public pipeline
  // --------------------
  preprocess(file) {
    return new Promise((resolve, reject) => {
      if (!file.name.endsWith('.java')) {
        reject(file.name + ' is not a java file. Discarding.');
      } else if (this.#myFileStore.isFileProcessed(file.name)) {
        reject(file.name + ' has already been processed.');
      } else {
        resolve(file);
      }
    });
  }

  transform(file) {
    file = this.#filterLines(file);
    file = this.#chunkify(file);
    return file;
  }

  matchDetect(file) {
    const allFiles = this.#myFileStore.getAllFiles();
    file.instances = file.instances || [];
    for (const f of allFiles) {
      if (f.name === file.name) continue; // skip self
      file = this.#filterCloneCandidates(file, f);
      file = this.#expandCloneCandidates(file);
      file = this.#consolidateClones(file);
    }
    return file;
  }

  pruneFile(file) {
    delete file.lines;
    delete file.instances;
    return file;
  }

  storeFile(file) {
    this.#myFileStore.storeFile(this.pruneFile(file));
    return file;
  }

  get numberOfProcessedFiles() {
    return this.#myFileStore.numberOfFiles;
  }
}

module.exports = CloneDetector;
