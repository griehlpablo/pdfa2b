const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

// Os caminhos do seu computador (mantidos conforme sua configuração atual)
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

async function validateWithVeraPdf(pdfPath) {
    try {
        // Adicionado aspas duplas para evitar erro com espaços no caminho
        const args = ["-f", "2b", "--format", "text", `"${pdfPath}"`];
        const { stdout, stderr } = await execFileAsync(VERAPDF_PATH, args, { windowsHide: true, shell: true });
        const combined = `${stdout || ""}\n${stderr || ""}`;
        return combined.includes("PASS") || combined.includes("PASSED") || combined.includes('isCompliant="true"');
    } catch (error) {
        return false;
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

            // --- NOVA LÓGICA DE PASTAS ---
            const originalDir = path.dirname(file);
            const targetDir = path.join(originalDir, "pdf a2b"); // Define o nome da subpasta
            const originalName = path.basename(file, ext);
            const outputPdfPath = path.join(targetDir, `${originalName}_A2B.pdf`);

            // Cria a pasta "pdf a2b" se ela ainda não existir
            fs.ensureDirSync(targetDir);
            // -----------------------------

            console.log(`⏳ Convertendo: ${originalName}.pdf`);
            await convertPdfToPdfA2b(file, outputPdfPath, renderedPdfaDefPath);
            
            console.log(`🔎 Validando com veraPDF...`);
            const isValid = await validateWithVeraPdf(outputPdfPath);

            if (isValid) {
                console.log(`✅ SUCESSO: Salvo em "pdf a2b\\${originalName}_A2B.pdf"`);
            } else {
                console.log(`⚠️ AVISO: Convertido, mas com alertas na validação estrita.`);
                console.log(`   Arquivo salvo em: "pdf a2b\\${originalName}_A2B.pdf"`);
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