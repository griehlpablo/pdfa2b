/*
=================================================================================
  ____ ____  ___ _____ _   _ _     
 / ___|  _ \|_ _| ____| | | | |    
| |  _| |_) || ||  _| | |_| | |    
| |_| |  _ < | || |___|  _  | |___ 
 \____|_| \_\___|_____|_| |_|_____|
 
 Desenvolvido por: @griehl_
 Conversor Local em Lote para padrão Arquivístico (PDF/A-2b)
=================================================================================
*/

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { execFile, exec } = require("child_process"); 
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec); 

const GS_PATH = "C:\\Program Files\\gs\\gs10.07.0\\bin\\gswin64c.exe";
const VERAPDF_PATH = "C:\\Users\\Unespar\\verapdf\\verapdf.bat";
const ICC_PROFILE_PATH = "C:\\Windows\\System32\\spool\\drivers\\color\\sRGB Color Space Profile.icm";

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

async function buildPdfaDefFromTemplate() {
    const psFriendlyICCPath = ICC_PROFILE_PATH.replace(/\\/g, "/");
    
    const psCode = `%!
/ICCProfile (${psFriendlyICCPath}) def

[ /_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[ {icc_PDFA} << /N 3 >> /PUT pdfmark
[ {icc_PDFA} ICCProfile (r) file /PUT pdfmark

[ /_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[ {OutputIntent_PDFA} <<
  /Type /OutputIntent
  /S /GTS_PDFA1
  /DestOutputProfile {icc_PDFA}
  /OutputConditionIdentifier (sRGB)
>> /PUT pdfmark
[ {Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark

[ /_objdef {xmlinfo} /type /stream /OBJ pdfmark
[ {xmlinfo} << /Type /Metadata /Subtype /XML >> /PUT pdfmark
[ {xmlinfo} currentfile 0 (% &&end&&) /SubFileDecode filter /PUT pdfmark
<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>2</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
% &&end&&
[ {Catalog} << /Metadata {xmlinfo} >> /PUT pdfmark
`.replace(/\r\n/g, '\n');
    
    const renderedPath = path.join(os.tmpdir(), `PDFA_def_${Date.now()}.ps`);
    await fs.writeFile(renderedPath, psCode, "utf8");
    return renderedPath;
}

async function convertPdfToPdfA2b(inputPdf, outputPdf, renderedPdfaDefPath) {
    // 1. PASSO DA FOTOCÓPIA DE TELA (O xeque-mate no CamScanner)
    const tempRasterPdf = path.join(os.tmpdir(), `raster_${Date.now()}_${path.basename(inputPdf)}`);
    const argsRasterize = [
        "-dBATCH", "-dNOPAUSE", "-dNOSAFER",
        "-dPrinted=false",        // A MÁGICA 1: Lê como monitor (Força a foto do CamScanner a aparecer e evita tela branca)
        "-dShowAnnots=true",      // Garante que tudo seja desenhado
        "-sDEVICE=pdfimage24",    // A MÁGICA 2: Transforma tudo num bloco de pixels (Destrói o Marked Content tóxico)
        "-r300",                  // Alta Qualidade (300 DPI) para o histórico ficar nítido
        "-sOutputFile=" + tempRasterPdf,
        inputPdf
    ];
    await execFileAsync(GS_PATH, argsRasterize, { windowsHide: true });

    // 2. PASSO DA BLINDAGEM: O arquivo agora é uma imagem pura sem metadados tóxicos.
    const argsA2b = [
        "-dPDFA=2", "-dBATCH", "-dNOPAUSE", "-dNOSAFER",
        "-dPDFACompatibilityPolicy=2", // RIGOR MÁXIMO
        "-sDEVICE=pdfwrite", 
        "-dProcessColorModel=/DeviceRGB",
        "-sColorConversionStrategy=RGB", 
        "-dAutoRotatePages=/None", 
        "-sOutputFile=" + outputPdf,
        renderedPdfaDefPath, tempRasterPdf
    ];
    
    try {
        await execFileAsync(GS_PATH, argsA2b, { windowsHide: true });
    } catch (error) {
        await fs.remove(outputPdf).catch(() => {});
        throw error; 
    } finally {
        await fs.remove(tempRasterPdf).catch(() => {});
    }
}

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
    console.log(" >> Conversor Automático PDF/A-2b (A Vitória Final) <<\n");

    const files = process.argv.slice(2);
    
    if (files.length === 0) {
        console.log(`${COLOR_YELLOW}Nenhum arquivo foi selecionado. Arraste arquivos para o atalho.${COLOR_RESET}`);
        return;
    }

    console.log(`🚀 Iniciando conversão de ${files.length} arquivo(s)...\n`);
    const renderedPdfaDefPath = await buildPdfaDefFromTemplate();

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

            console.log(`⏳ Fotocopiando e Convertendo: ${originalName}.pdf`);
            await convertPdfToPdfA2b(file, outputPdfPath, renderedPdfaDefPath);
            
            console.log(`🔎 Validando com veraPDF...`);
            const { isValid } = await validateWithVeraPdf(outputPdfPath);

            if (isValid) {
                console.log(`${COLOR_GREEN}✅ SUCESSO: Salvo em "pdf a2b\\${originalName}_A2B.pdf"${COLOR_RESET}`);
            } else {
                console.log(`${COLOR_RED}⚠️ FALHA NA VALIDAÇÃO: O arquivo não passou no teste do VeraPDF.${COLOR_RESET}`);
            }
            console.log("---------------------------------------------------");
            
        } catch (error) {
            let shortError = "Erro desconhecido na conversão.";
            
            if (error.message) {
                const lines = error.message.split('\n');
                shortError = lines.find(line => line.includes('Error:') || line.includes('Unrecoverable error') || line.includes('GPL Ghostscript')) || "Falha no motor Ghostscript.";
            }

            console.log(`${COLOR_RED}🚨 ERRO CRÍTICO: ${shortError}${COLOR_RESET}`);
            console.log("---------------------------------------------------");
            
            if (targetDir && originalName) {
                const errorLogPath = path.join(targetDir, `${originalName}_ERRO_CRITICO.txt`);
                const errorMessage = `FALHA NA CONVERSÃO DO ARQUIVO: ${originalName}.pdf\n\nEste arquivo não pôde ser convertido para PDF/A-2b.\nProváveis causas: O PDF original está corrompido, protegido por senha, ou possui falhas graves na estrutura interna.\n\nDetalhe técnico do erro:\n${error.message}`;
                
                fs.writeFileSync(errorLogPath, errorMessage, "utf8");
            }
        }
    }
    
    await fs.remove(renderedPdfaDefPath);
    console.log("🎉 Processo concluído com sucesso!");
}

processFiles();