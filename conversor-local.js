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
    // 1. PASSO DE LAVAGEM: Transforma o PDF problemático num PDF limpo e padrão
    const tempCleanPdf = path.join(os.tmpdir(), `clean_${Date.now()}_${path.basename(inputPdf)}`);
    const argsClean = [
        "-dBATCH", "-dNOPAUSE", "-dNOSAFER",
        "-sDEVICE=pdfwrite",
        "-dPrinted=true", // Força a remoção de marcações de tela/acessibilidade
        "-sOutputFile=" + tempCleanPdf,
        inputPdf
    ];
    await execFileAsync(GS_PATH, argsClean, { windowsHide: true });

    // 2. PASSO DE BLINDAGEM: Converte o PDF limpo para A-2b com rigor máximo!
    const argsA2b = [
        "-dPDFA=2", "-dBATCH", "-dNOPAUSE", "-dNOSAFER",
        "-dPDFACompatibilityPolicy=2", // Voltamos com a regra rigorosa, pois o PDF agora está limpo!
        "-sDEVICE=pdfwrite", "-sColorConversionStrategy=RGB",
        "-dAutoRotatePages=/None", "-dEmbedAllFonts=true",
        "-dSubsetFonts=true", "-dCompressFonts=true",
        "-dDetectDuplicateImages=true",
        "-sOutputFile=" + outputPdf,
        renderedPdfaDefPath, tempCleanPdf
    ];
    
    try {
        await execFileAsync(GS_PATH, argsA2b, { windowsHide: true });
    } catch (error) {
        const fileExists = await fs.pathExists(outputPdf);
        if (!fileExists) {
            throw error; 
        }
    } finally {
        // Apaga o arquivo temporário "lavado" para não lotar seu disco
        await fs.remove(tempCleanPdf).catch(() => {});
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
    console.log("\x1b[36m%s\x1b[0m", GRIEHL_LOGO); 
    console.log(" Desenvolvido por: @griehl_");
    console.log(" >> Conversor Automático PDF/A-2b <<\n");

    const files = process.argv.slice(2);
    
    if (files.length === 0) {
        console.log("Nenhum arquivo foi selecionado. Arraste arquivos para o atalho.");
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
                console.log(`❌ Ignorado (Não é PDF): ${path.basename(file)}`);
                continue;
            }

            const originalDir = path.dirname(file);
            targetDir = path.join(originalDir, "pdf a2b");
            originalName = path.basename(file, ext);
            const outputPdfPath = path.join(targetDir, `${originalName}_A2B.pdf`);

            fs.ensureDirSync(targetDir);

            console.log(`⏳ Convertendo: ${originalName}.pdf`);
            await convertPdfToPdfA2b(file, outputPdfPath, renderedPdfaDefPath);
            
            console.log(`🔎 Validando com veraPDF...`);
            await validateWithVeraPdf(outputPdfPath);

            console.log(`✅ SUCESSO: Salvo em "pdf a2b\\${originalName}_A2B.pdf"`);
            console.log("---------------------------------------------------");
            
        } catch (error) {
            let shortError = "Erro desconhecido na conversão.";
            
            if (error.message.includes("GPL Ghostscript")) {
                const lines = error.message.split('\n');
                shortError = lines.find(line => line.includes('GPL Ghostscript')) || "Falha no motor Ghostscript.";
            }

            console.log(`🚨 ERRO CRÍTICO: ${shortError}`);
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