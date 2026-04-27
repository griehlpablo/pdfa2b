const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const archiver = require("archiver");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const execFileAsync = promisify(execFile);

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 150 * 1024 * 1024
  }
});

const ROOT_DIR = __dirname;
const WORK_DIR = path.join(ROOT_DIR, "work");
fs.ensureDirSync(WORK_DIR);

const GS_PATH = process.env.GHOSTSCRIPT_PATH || "gswin64c";
const SOFFICE_PATH = process.env.LIBREOFFICE_PATH || "soffice";
const VERAPDF_PATH = process.env.VERAPDF_PATH || "verapdf.bat";

const ICC_PROFILE_PATH = path.resolve(ROOT_DIR, process.env.ICC_PROFILE_PATH || "./color/sRGB.icc");
const PDFA_DEF_PATH = path.resolve(ROOT_DIR, process.env.PDFA_DEF_PATH || "./config/PDFA_def.ps");

function normalizeWindowsPathForPostScript(filePath) {
  return filePath.replace(/\\/g, "/");
}

function getExtension(filename) {
  return path.extname(filename).toLowerCase();
}

function isPdf(ext) {
  return ext === ".pdf";
}

function isOfficeLike(ext) {
  return [
    ".doc", ".docx", ".odt", ".rtf", ".txt",
    ".xls", ".xlsx", ".ods", ".csv",
    ".ppt", ".pptx", ".odp"
  ].includes(ext);
}

async function ensureExecutableExists(exePath, nameForError) {
  try {
    await fs.access(exePath);
  } catch {
    throw new Error(`${nameForError} não encontrado em: ${exePath}`);
  }
}

async function ensureBaseFiles() {
  await ensureExecutableExists(GS_PATH, "Ghostscript");
  await ensureExecutableExists(ICC_PROFILE_PATH, "ICC profile");
  await ensureExecutableExists(PDFA_DEF_PATH, "PDFA_def.ps");

  // LibreOffice só é exigido para arquivos não-PDF
}

async function convertOfficeToPdf(inputPath, outputDir) {
  await ensureExecutableExists(SOFFICE_PATH, "LibreOffice");

  const args = [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    inputPath
  ];

  await execFileAsync(SOFFICE_PATH, args, { windowsHide: true });

  const basename = path.basename(inputPath, path.extname(inputPath));
  const outputPdf = path.join(outputDir, `${basename}.pdf`);

  if (!(await fs.pathExists(outputPdf))) {
    throw new Error("LibreOffice não gerou o PDF intermediário.");
  }

  return outputPdf;
}

async function buildPdfaDefFromTemplate(jobDir) {
  const template = await fs.readFile(PDFA_DEF_PATH, "utf8");
  const psFriendlyICCPath = normalizeWindowsPathForPostScript(ICC_PROFILE_PATH);

  const rendered = template.replace(/__ICC_PROFILE_PATH__/g, psFriendlyICCPath);

  const renderedPath = path.join(jobDir, "PDFA_def_rendered.ps");
  await fs.writeFile(renderedPath, rendered, "utf8");

  return renderedPath;
}

async function convertPdfToPdfA2b(inputPdf, outputPdf, renderedPdfaDefPath) {
  const args = [
    "-dPDFA=2",
    "-dBATCH",
    "-dNOPAUSE",
    "-dSAFER",
    "-sDEVICE=pdfwrite",
    "-sColorConversionStrategy=RGB",
    "-dAutoRotatePages=/None",
    "-dEmbedAllFonts=true",
    "-dSubsetFonts=true",
    "-dCompressFonts=true",
    "-dDetectDuplicateImages=true",
    "-dDownsampleColorImages=false",
    "-dDownsampleGrayImages=false",
    "-dDownsampleMonoImages=false",
    "-sOutputFile=" + outputPdf,
    renderedPdfaDefPath,
    inputPdf
  ];

  await execFileAsync(GS_PATH, args, { windowsHide: true });

  if (!(await fs.pathExists(outputPdf))) {
    throw new Error("Ghostscript não gerou o PDF/A de saída.");
  }
}

async function validateWithVeraPdf(pdfPath) {
  try {
    await ensureExecutableExists(VERAPDF_PATH, "veraPDF");
  } catch {
    return {
      available: false,
      passed: null,
      raw: "veraPDF não encontrado; validação pulada."
    };
  }

  try {
    const args = ["-f", "2b", "--format", "text", pdfPath];
    const { stdout, stderr } = await execFileAsync(VERAPDF_PATH, args, { windowsHide: true });

    const combined = `${stdout || ""}\n${stderr || ""}`;
    const passed =
      combined.includes("PASS") ||
      combined.includes("PASSED") ||
      combined.includes('isCompliant="true"');

    const failed =
      combined.includes("FAIL") ||
      combined.includes('isCompliant="false"');

    return {
      available: true,
      passed: passed ? true : failed ? false : null,
      raw: combined.trim()
    };
  } catch (error) {
    return {
      available: true,
      passed: false,
      raw: error.stdout || error.stderr || error.message || "Falha na validação com veraPDF."
    };
  }
}

async function processOneFile(file, batchDir) {
  const originalName = file.originalname;
  const ext = getExtension(originalName);
  const itemId = uuidv4();
  const itemDir = path.join(batchDir, itemId);
  await fs.ensureDir(itemDir);

  const inputPath = path.join(itemDir, originalName);
  await fs.move(file.path, inputPath, { overwrite: true });

  const result = {
    originalName,
    inputExt: ext,
    status: "pending",
    message: "",
    outputPdfName: null,
    outputPdfPath: null,
    validation: null
  };

  try {
    let sourcePdfPath = inputPath;

    if (isPdf(ext)) {
      // já é PDF
    } else if (isOfficeLike(ext)) {
      sourcePdfPath = await convertOfficeToPdf(inputPath, itemDir);
    } else {
      throw new Error("Formato não suportado nesta versão.");
    }

    const renderedPdfaDefPath = await buildPdfaDefFromTemplate(itemDir);

    const outputPdfName = `${path.parse(originalName).name}-PDFA-2B.pdf`;
    const outputPdfPath = path.join(itemDir, outputPdfName);

    await convertPdfToPdfA2b(sourcePdfPath, outputPdfPath, renderedPdfaDefPath);

    const validation = await validateWithVeraPdf(outputPdfPath);

    result.outputPdfName = outputPdfName;
    result.outputPdfPath = outputPdfPath;
    result.validation = validation;

    if (validation.available && validation.passed === false) {
      result.status = "failed-validation";
      result.message = "Arquivo convertido, mas falhou na validação PDF/A-2b.";
    } else if (validation.available && validation.passed === true) {
      result.status = "passed";
      result.message = "Arquivo convertido e validado como PDF/A-2b.";
    } else {
      result.status = "converted-not-validated";
      result.message = "Arquivo convertido, mas sem validação final disponível.";
    }

    return result;
  } catch (error) {
    result.status = "error";
    result.message = error.message || "Erro ao processar o arquivo.";
    return result;
  }
}

async function buildZipFromResults(results, batchDir) {
  const zipPath = path.join(batchDir, "resultado-lote.zip");
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  return new Promise(async (resolve, reject) => {
    output.on("close", () => resolve(zipPath));
    archive.on("error", (err) => reject(err));

    archive.pipe(output);

    const report = {
      createdAt: new Date().toISOString(),
      totals: {
        files: results.length,
        passed: results.filter(r => r.status === "passed").length,
        failedValidation: results.filter(r => r.status === "failed-validation").length,
        convertedNotValidated: results.filter(r => r.status === "converted-not-validated").length,
        errors: results.filter(r => r.status === "error").length
      },
      files: results.map(r => ({
        originalName: r.originalName,
        status: r.status,
        message: r.message,
        outputPdfName: r.outputPdfName,
        validationAvailable: r.validation?.available ?? false,
        validationPassed: r.validation?.passed ?? null,
        validationRaw: r.validation?.raw ?? null
      }))
    };

    archive.append(JSON.stringify(report, null, 2), { name: "report.json" });

    for (const item of results) {
      if (!item.outputPdfPath || !(await fs.pathExists(item.outputPdfPath))) continue;

      if (item.status === "passed") {
        archive.file(item.outputPdfPath, { name: `passed/${item.outputPdfName}` });
      } else {
        archive.file(item.outputPdfPath, { name: `failed-validation/${item.outputPdfName}` });
      }
    }

    await archive.finalize();
  });
}

app.post("/convert-batch", upload.array("files", 50), async (req, res) => {
  let batchDir = null;

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Nenhum arquivo enviado." });
    }

    await ensureBaseFiles();

    batchDir = path.join(WORK_DIR, uuidv4());
    await fs.ensureDir(batchDir);

    const results = [];
    for (const file of req.files) {
      const itemResult = await processOneFile(file, batchDir);
      results.push(itemResult);
    }

    const anyGenerated = results.some(r => r.outputPdfPath);

    if (!anyGenerated) {
      return res.status(400).json({
        error: "Nenhum PDF foi gerado no lote.",
        details: results
      });
    }

    const zipPath = await buildZipFromResults(results, batchDir);

    res.download(zipPath, "lote-pdfa2b.zip", async (err) => {
      if (err) {
        console.error("Erro ao enviar ZIP:", err);
      }

      setTimeout(async () => {
        try {
          if (batchDir) await fs.remove(batchDir);
        } catch (cleanupErr) {
          console.error("Erro ao limpar lote:", cleanupErr);
        }
      }, 60000);
    });
  } catch (error) {
    console.error(error);

    if (req.files?.length) {
      for (const file of req.files) {
        try {
          if (file.path && await fs.pathExists(file.path)) {
            await fs.remove(file.path);
          }
        } catch {}
      }
    }

    if (batchDir && await fs.pathExists(batchDir)) {
      await fs.remove(batchDir);
    }

    return res.status(500).json({
      error: error.message || "Erro interno ao processar o lote."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});