/*
=================================================================================
  ____ ____  ___ _____ _   _ _     
 / ___|  _ \|_ _| ____| | | | |    
| |  _| |_) || ||  _| | |_| | |    
| |_| |  _ < | || |___|  _  | |___ 
 \____|_| \_\___|_____|_| |_|_____|
 
 Desenvolvido por: @griehl_
 Conversor Local em Lote - Padrão Arquivístico (PDF/A-2b)
=================================================================================
*/

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { execFile, exec } = require("child_process"); 
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec); 

// Caminhos originais validados no seu sistema
const GS_PATH = "C:\\Program Files\\gs\\gs10.07.0\\bin\\gswin64c.exe";
const VERAPDF_PATH = "C:\\Users\\Unespar\\verapdf\\verapdf.bat";

const COLOR_CYAN = "\x1b[36m";
const COLOR_GREEN = "\x1b[32m";
const COLOR_RED = "\x1b[31m";
const COLOR_YELLOW = "\x1b[33m";
const COLOR_RESET = "\x1b[0m";

const GRIEHL_LOGO = [
    "  ____ ____  ___ _____ _   _ _     ",
    " / ___|  _ \\|_ _| ____| | | | |    ",
    "| |  _| |_) || ||  _| | |_| | |    ",
    "| |_| |  _ < | || |___|  _  | |___ ",
    " \\____|_| \\_\\___|_____|_| |_|_____|"
].join('\n');

async function convertPdfToPdfA2b(inputPdf, outputPdf) {
    const tempRasterPdf = path.join(os.tmpdir(), `TEMP_HD_${Date.now()}_${path.basename(inputPdf)}`);

    // =================================================================
    // PASSO 1: RASTERIZAÇÃO EM ALTA DEFINIÇÃO (600 DPI)
    // =================================================================
    const argsRasterize = [
        "-dNOPAUSE", 
        "-dBATCH", 
        "-dNOSAFER",
        "-sDEVICE=pdfimage24",
        "-r600",                // Qualidade Profissional
        "-dDownScaleFactor=2",  // Antialiasing para letras nítidas
        "-o" + tempRasterPdf,
        inputPdf
    ];
    
    try {
        await execFileAsync(GS_PATH, argsRasterize, { windowsHide: true });
    } catch (e) {
        throw new Error("Falha na captura de imagem (600 DPI): " + (e.stderr || e.message));
    }

    // =================================================================
    // PASSO 2: CONVERSÃO FINAL PARA PDF/A-2b
    // =================================================================
    const argsA2b = [
        "-sDEVICE=pdfwrite", 
        "-dPDFA=2", 
        "-dPDFACompatibilityPolicy=1", 
        "-sColorConversionStrategy=UseDeviceIndependentColor", 
        "-o" + outputPdf,
        tempRasterPdf 
    ];
    
    try {
        await execFileAsync(GS_PATH, argsA2b, { windowsHide: true });
    } catch (e) {
        await fs.remove(outputPdf).catch(() => {});
        throw new Error("Falha na blindagem PDF/A-2b: " + (e.stderr || e.message));
    } finally {
        await fs.remove(tempRasterPdf).catch(() => {});
    }
}

// Validação automática no VeraPDF
async function validateWithVeraPdf(pdfPath) {
    try {
        const command = `"${VERAPDF_PATH}" -f 2b --format text "${pdfPath}"`;
        const { stdout } = await execAsync(command, { windowsHide: true });
        
        const isValid = stdout.includes("PASS") || stdout.includes("PASSED") || stdout.includes('isCompliant="true"');
        return { isValid }; 
    } catch (error) {
        const stdout = error.stdout || "";
        const isValid = stdout.includes("PASS") || stdout.includes("PASSED") || stdout.includes('isCompliant="true"');
        return { isValid };
    }
}

async function processFiles() {
    console.log(`${COLOR_CYAN}%s${COLOR_RESET}`, GRIEHL_LOGO); 
    console.log(" Desenvolvido por: @griehl_");

    const files = process.argv.slice(2);
    
    if (files.length === 0) {
        console.log(`${COLOR_YELLOW}Nenhum arquivo foi selecionado. Arraste arquivos para o atalho.${COLOR_RESET}`);
        return;
    }

    console.log(`🚀 Iniciando conversão de ${files.length} arquivo(s)...\n`);

    for (const file of files) {
        let targetDir = "";
        let originalName = "";
        
        try {
            const ext = path.extname(file).toLowerCase();
            if (ext !== '.pdf') {
                console.log(`${COLOR_YELLOW}❌ Ignorado (Não é PDF): ${path.basename(file)}${COLOR_RESET}`);
                continue;
            }

            const originalDir = path.dirname(file);
            targetDir = path.join(originalDir, "pdf a2b");
            originalName = path.basename(file, ext);
            const outputPdfPath = path.join(targetDir, `${originalName}_A2B.pdf`);

            fs.ensureDirSync(targetDir);

            console.log(`⏳ Convertendo para A2B: ${originalName}.pdf`);
            await convertPdfToPdfA2b(file, outputPdfPath);
            
            console.log(`🔎 Validando com veraPDF...`);
            const { isValid } = await validateWithVeraPdf(outputPdfPath);

            if (isValid) {
                console.log(`${COLOR_GREEN}✅ SUCESSO: Salvo em "pdf a2b\\${originalName}_A2B.pdf"${COLOR_RESET}`);
            } else {
                console.log(`${COLOR_RED}⚠️ FALHA NA VALIDAÇÃO: O arquivo não passou no teste do VeraPDF.${COLOR_RESET}`);
            }
            console.log("---------------------------------------------------");
            
        } catch (error) {
            console.log(`${COLOR_RED}🚨 ERRO CRÍTICO: ${error.message}${COLOR_RESET}`);
            console.log("---------------------------------------------------");
            
            if (targetDir && originalName) {
                const errorLogPath = path.join(targetDir, `${originalName}_ERRO_CRITICO.txt`);
                const errorMessage = `FALHA NA CONVERSÃO HD: ${originalName}.pdf\n\nErro técnico:\n${error.message}`;
                fs.writeFileSync(errorLogPath, errorMessage, "utf8");
            }
        }
    }
    
    console.log("🎉 Processo de conversão concluído!");
}

processFiles();