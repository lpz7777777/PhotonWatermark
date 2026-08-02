import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships all watermark presets and local export paths", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  for (const preset of ["classic", "noir", "gallery", "overlay", "film", "kodak", "fujifilm", "editorial", "monolith", "archive", "centered", "immersive", "sidecar"]) {
    assert.match(page, new RegExp(`id: "${preset}"`));
  }
  for (const exifField of ["Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO", "FocalLength", "DateTimeOriginal"]) {
    assert.match(page, new RegExp(`"${exifField}"`));
  }
  assert.match(page, /canvas\.toBlob/);
  assert.match(page, /image\/png/);
  assert.match(page, /compression: "STORE"/);
});

test("uses official logo assets and shared batch EXIF overrides", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  for (const asset of ["canon-mark.png", "nikon.svg", "sony.svg", "fujifilm.svg", "leica.svg", "hasselblad.svg", "omsystem.svg", "olympus.png", "panasonic.png", "ricoh.svg", "dji.svg", "apple.svg", "huawei.svg", "honor.svg", "xiaomi.svg", "oppo.svg", "vivo.svg"]) {
    assert.match(page, new RegExp(asset.replace(".", "\\.")));
    await access(new URL(`public/brands/${asset}`, root));
  }
  assert.match(page, /autoMetadata: \{ \.\.\.metadata \}/);
  assert.match(page, /updateSharedMetadata/);
  assert.match(page, /resetSharedMetadata/);
  assert.match(page, /sharedMetadataOverridesRef/);
  assert.match(page, /setPhotos\(\(current\) => current\.map\(\(photo\) => settings\.filmMode/);
  assert.match(page, /metadata: \{ \.\.\.photo\.metadata, \.\.\.sharedMetadataOverridesRef\.current\.standard \}/);
  assert.match(page, /filmMetadata: \{ \.\.\.photo\.filmMetadata, \.\.\.sharedMetadataOverridesRef\.current\.film \}/);
  assert.match(page, /type="datetime-local"/);
  assert.match(page, /showSignature: boolean/);
  assert.match(page, /settings\.showSignature && settings\.signature/);
  assert.match(page, /normalizedMake[\s\S]*normalizedModel[\s\S]*normalizedMake\.includes[\s\S]*normalizedModel\.includes/);
  for (const keyword of ["IPHONE", "HUAWEI", "HONOR", "XIAOMI", "OPPO", "VIVO"]) {
    assert.match(page, new RegExp(`keywords: \\[.*${keyword}`));
  }
  assert.match(page, /brand\.value === "HONOR" \? 2 : 1/);
  assert.match(page, /"BKQ-AN90" \? "Magic 8 Pro"/);
  const filmStart = page.indexOf("function drawFilmBand");
  const filmEnd = page.indexOf("function renderPhoto", filmStart);
  assert.match(page.slice(filmStart, filmEnd), /drawBrand\(context, meta\.make/);
});

test("static GitHub Pages build is portable", async () => {
  const html = await readFile(new URL("gh-pages/index.html", root), "utf8");
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /Photon Frame/);
  assert.match(html, /\.\/assets\/index-[^"]+\.js/);
  assert.match(html, /\.\/og\.png/);
  await access(new URL("gh-pages/og.png", root));
});

test("supports independent metadata switches, film workflow and movable elements", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  for (const field of ["showModel", "showFocalLength", "showIso", "showAperture", "showExposure", "showFilmBrand", "showFilmName", "showLab", "showScanner"]) {
    assert.match(page, new RegExp(`${field}: boolean`));
    assert.match(page, new RegExp(`settings\\.${field}`));
  }
  for (const asset of ["kodak.png", "lucky.png", "noritsu.svg", "fujifilm.svg"]) {
    assert.match(page, new RegExp(asset.replace(".", "\\.")));
    await access(new URL(`public/brands/${asset}`, root));
  }
  assert.match(page, /function drawFilmWorkflowBand/);
  assert.match(page, /handleElementPointerDown/);
  assert.match(page, /onPointerMove=\{handleElementPointerMove\}/);
  assert.match(page, /onDoubleClick=\{handleElementDoubleClick\}/);
  assert.match(page, /drawSelectionOverlay/);
  assert.match(page, /elementAtPoint/);
  assert.match(page, /mode: "move" \| "resize"/);
  assert.match(page, /fontScale/);
  assert.match(page, /currentLayoutKey/);
  assert.match(page, /`film-mode-\$\{settings\.preset\}`/);
  assert.doesNotMatch(page, /const background = settings\.filmMode \|\|/);
  assert.match(page, /filmBandSize: number/);
  assert.match(page, /bandSize: 12/);
  assert.match(page, /filmBandSize: 12/);
  assert.match(page, /activeBandSize = settings\.filmMode \? settings\.filmBandSize : settings\.bandSize/);
  assert.match(page, /const contentHeight = layout\.photoHeight \* 0\.1612/);
  assert.match(page, /modelX: 0\.28[\s\S]*lensX: 0\.45/);
  for (const parameterX of ["0.32", "0.41", "0.5", "0.6"]) assert.match(page, new RegExp(`[A-Za-z]+X: ${parameterX.replace(".", "\\.")}`));
  assert.match(page, /filmMetadata: \{ \.\.\.defaultFilmMetadata \}/);
  for (const filmDefault of ['make: "OLYMPUS"', 'model: "OM-1"', 'lens: "50mm/1.8"', 'iso: "100"']) {
    assert.match(page, new RegExp(filmDefault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const hiddenByDefault of ["filmShowDate", "filmShowExposure", "filmShowAperture", "filmShowFocalLength"]) {
    assert.match(page, new RegExp(`${hiddenByDefault}: false`));
  }
  for (const anchor of ["cameraLogoX", "detailsPrimaryX", "detailsSecondaryX", "scannerLogoX", "scannerModelX", "filmLogoX", "filmNameX", "filmIsoX", "labLabelX", "labNameX"]) {
    assert.match(page, new RegExp(`const ${anchor} =`));
  }
  assert.match(page, /brand\.value === "LUCKY"/);
  assert.match(page, /function themePalette/);
  assert.match(page, /#FFB700/);
  assert.match(page, /#ED0000/);
  assert.match(page, /#01916D/);
  assert.match(page, /#99D3C5/);
  assert.match(page, /settings\.preset === "kodak" \|\| settings\.preset === "fujifilm" \? contentHeight \* 0\.055 : 0/);
  assert.match(page, /const splitX = x \+ width \* 0\.287/);
  assert.match(page, /const stripeHeight = Math\.max\(6, layout\.photoHeight \* 0\.014\)/);
  assert.doesNotMatch(page, /fillRect\(x \+ width \* 0\.028/);
  for (const advancedPreset of ["editorial", "monolith", "archive"]) {
    assert.match(page, new RegExp(`settings\\.preset === "${advancedPreset}"`));
    assert.match(page, new RegExp(`preset === "${advancedPreset}"`));
  }
  assert.match(page, /className="topbar-actions"/);
  assert.match(page, /className="top-export"/);
  assert.match(page, /className="top-export batch"/);
  assert.match(page, /className=\{`top-film-switch/);
  assert.match(page, /modelX: 0\.22, modelY: 0\.5/);
  for (const referencePreset of ["centered", "immersive", "sidecar"]) {
    assert.match(page, new RegExp(`settings\\.preset === "${referencePreset}"`));
  }
  for (const renderer of ["drawCenteredCard", "drawImmersiveCard", "drawSidecarCard"]) {
    assert.match(page, new RegExp(`function ${renderer}`));
  }
});

test("starter preview markers are gone", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
