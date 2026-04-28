const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const GS_PATH = "C:\\Program Files\\gs\\gs10.07.0\\bin\\gswin64c.exe";
const VERAPDF_PATH = "C:\\Users\\Unespar\\verapdf\\verapdf.bat";
const ICC_PROFILE_PATH = "C:\\Windows\\System32\\spool\\drivers\\color\\sRGB Color Space Profile.icm";
const PDFA_DEF_PATH = path.join(__dirname, "config", "PDFA_def.ps");

async function buildPdfaDefFromTemplate() {
    const template = await fs.readFile(PDFA_DEF_PATH, "utf8");
    const psFriendlyICCPath = ICC_PROFILE_PATH.replace(/\\/g, "/");
    const rendered = template.replace(/__ICC_PROFILE_PATH__/g, psFriendlyICCPath);
    const renderedPath = path.join(os.tmpdir(), `PDFA_def_${Date.now()}.ps`);
    await fs.writeFile(renderedPath, rendered, "utf8");
    return renderedPath;
}

async function convertPdfToPdfA2b(inputPdf, outputPdf, renderedPdfaDefPath) {
    const args = [
        "-dPDFA=2", "-dBATCH", "-dNOPAUSE", "-dNOSAFER",
        "-sDEVICE=pdfwrite", "-sColorConversionStrategy=RGB",
        "-dAutoRotatePages=/None", "-dEmbedAllFonts=true",
        "-dSubsetFonts=true", "-dCompressFonts=true",
        "-dDetectDuplicateImages=true",
        "-sOutputFile=" + outputPdf,
        renderedPdfaDefPath, inputPdf
    ];
    await execFileAsync(GS_PATH, args, { windowsHide: true });
}

// Atualizado para retornar o log de texto do veraPDF além do status
async function validateWithVeraPdf(pdfPath) {
    try {
        const args = ["-f", "2b", "--format", "text", `"${pdfPath}"`];
        const { stdout, stderr } = await execFileAsync(VERAPDF_PATH, args, { windowsHide: true, shell: true });
        const combined = `${stdout || ""}\n${stderr || ""}`;
        const isValid = combined.includes("PASS") || combined.includes("PASSED") || combined.includes('isCompliant="true"');
        return { isValid, log: combined.trim() };
    } catch (error) {
        return { isValid: false, log: error.message };
    }
}

async function processFiles() {
    const files = process.argv.slice(2);
    
    if (files.length === 0) {
        console.log("Nenhum arquivo foi selecionado.");
        return;
    }

    console.log(`\n🚀 Iniciando conversão de ${files.length} arquivo(s)...\n`);
    const renderedPdfaDefPath = await buildPdfaDefFromTemplate();

    for (const file of files) {
        try {
            const ext = path.extname(file).toLowerCase();
            if (ext !== '.pdf') {
                console.log(`❌ Ignorado (Não é PDF): ${path.basename(file)}`);
                continue;
            }

            const originalDir = path.dirname(file);
            const targetDir = path.join(originalDir, "pdf a2b");
            const originalName = path.basename(file, ext);
            const outputPdfPath = path.join(targetDir, `${originalName}_A2B.pdf`);

            fs.ensureDirSync(targetDir);

            console.log(`⏳ Convertendo: ${originalName}.pdf`);
            await convertPdfToPdfA2b(file, outputPdfPath, renderedPdfaDefPath);
            
            console.log(`🔎 Validando com veraPDF...`);
            const { isValid, log } = await validateWithVeraPdf(outputPdfPath); // Captura o log

            if (isValid) {
                console.log(`✅ SUCESSO: Salvo em "pdf a2b\\${originalName}_A2B.pdf"`);
            } else {
                console.log(`⚠️ AVISO: Convertido, mas com alertas na validação estrita.`);
                
                // Salva o laudo em .txt para você inspecionar
                const logPath = path.join(targetDir, `${originalName}_laudo_verapdf.txt`);
                await fs.writeFile(logPath, log, "utf8");
                console.log(`   📝 Laudo do alerta salvo em: "pdf a2b\\${originalName}_laudo_verapdf.txt"`);
            }
            console.log("---------------------------------------------------");
        } catch (error) {
            console.log(`🚨 ERRO ao processar ${path.basename(file)}:`, error.message);
            console.log("---------------------------------------------------");
        }
    }
    
    await fs.remove(renderedPdfaDefPath);
    console.log("🎉 Processo concluído!");
}

processFiles();