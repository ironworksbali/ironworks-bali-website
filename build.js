const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, 'images');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

// Folders to skip inside any category directory
const SKIP_DIRS = ['orig'];

// Source formats we'll try to convert
const CONVERTIBLE_EXTS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.gif'];
const WEBP_EXT = '.webp';

// Output settings
const MAX_WIDTH = 1800;   // px — large enough for lightbox on any screen
const QUALITY   = 82;     // webp quality (0-100)

// Category display names (add a row here whenever a new subfolder is created)
const CATEGORY_META = {
  mirror:    { label: 'Mirrors',      labelId: 'Cermin'        },
  stair:     { label: 'Staircases',   labelId: 'Tangga'        },
  sign:      { label: 'Signs',        labelId: 'Papan Tanda'   },
  table:     { label: 'Tables',       labelId: 'Meja'          },
  doorFrame: { label: 'Door Frames',  labelId: 'Bingkai Pintu' },
  roofRack:  { label: 'Roof Racks',   labelId: 'Roof Rack'     },
};

// Display order for categories (unknown categories appear at the end)
const CATEGORY_ORDER = ['mirror', 'table', 'stair', 'doorFrame', 'sign', 'roofRack'];

// Extract a sortable date integer from a filename (e.g. IMG-20230412 → 20230412)
function extractDate(filename) {
  const match = filename.match(/(\d{8})/);
  return match ? parseInt(match[1], 10) : 0;
}

async function convertImage(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .rotate()                                          // auto-rotate from EXIF
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(outputPath);
    console.log(`  converted → ${path.basename(outputPath)}`);
    return true;
  } catch (err) {
    console.warn(`  WARNING: could not convert ${path.basename(inputPath)}: ${err.message}`);
    return false;
  }
}

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error('images/ directory not found');
    process.exit(1);
  }

  const categories = [];

  const catDirs = fs.readdirSync(IMAGES_DIR).filter(name => {
    const fullPath = path.join(IMAGES_DIR, name);
    return fs.statSync(fullPath).isDirectory() && !SKIP_DIRS.includes(name);
  });

  for (const catDir of catDirs) {
    const catPath = path.join(IMAGES_DIR, catDir);
    const meta = CATEGORY_META[catDir] || { label: catDir, labelId: catDir };

    console.log(`\n[${catDir}]`);

    // Collect all files directly in this folder (not subdirs)
    const allFiles = fs.readdirSync(catPath).filter(f => {
      const fullPath = path.join(catPath, f);
      return fs.statSync(fullPath).isFile();
    });

    // Set of base names that already have a .webp in the folder
    const existingWebp = new Set(
      allFiles
        .filter(f => path.extname(f).toLowerCase() === WEBP_EXT)
        .map(f => path.basename(f, WEBP_EXT).toLowerCase())
    );

    // Convert any non-webp images that don't already have a webp counterpart
    for (const file of allFiles) {
      const ext = path.extname(file).toLowerCase();
      if (!CONVERTIBLE_EXTS.includes(ext)) continue;

      const baseName = path.basename(file, ext);
      if (existingWebp.has(baseName.toLowerCase())) {
        console.log(`  skipped  (webp exists) ${file}`);
        continue;
      }

      const inputPath  = path.join(catPath, file);
      const outputPath = path.join(catPath, baseName + WEBP_EXT);
      const ok = await convertImage(inputPath, outputPath);
      if (ok) existingWebp.add(baseName.toLowerCase());
    }

    // Collect all webp files now present in the folder
    const webpFiles = fs.readdirSync(catPath)
      .filter(f => path.extname(f).toLowerCase() === WEBP_EXT && fs.statSync(path.join(catPath, f)).isFile())
      .sort((a, b) => extractDate(b) - extractDate(a)); // newest first

    if (webpFiles.length === 0) {
      console.log('  no images, skipping category');
      continue;
    }

    const imagePaths = webpFiles.map(f => `images/${catDir}/${f}`);

    categories.push({
      id:      catDir,
      label:   meta.label,
      labelId: meta.labelId,
      cover:   imagePaths[0],          // most recent image as cover
      images:  imagePaths,
    });

    console.log(`  ${webpFiles.length} images`);
  }

  // Sort into the preferred display order
  categories.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.id);
    const bi = CATEGORY_ORDER.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const manifest = { categories };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  // Inject manifest inline into index.html so the gallery works when
  // the file is opened directly (file://) as well as when served over HTTP.
  const INDEX_PATH = path.join(__dirname, 'index.html');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const injected = html.replace(
    /<!-- MANIFEST:START -->[\s\S]*?<!-- MANIFEST:END -->/,
    `<!-- MANIFEST:START --><script>window.__GALLERY_MANIFEST__ = ${JSON.stringify(manifest)};</script><!-- MANIFEST:END -->`
  );
  fs.writeFileSync(INDEX_PATH, injected);

  const totalImages = categories.reduce((sum, c) => sum + c.images.length, 0);
  console.log(`manifest.json written and injected into index.html — ${categories.length} categories, ${totalImages} images total\n`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
