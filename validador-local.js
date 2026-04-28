/*
=================================================================================
  ____ ____  ___ _____ _   _ _     
 / ___|  _ \|_ _| ____| | | | |    
| |  _| |_) || ||  _| | |_| | |    
| |_| |  _ < | || |___|  _  | |___ 
 \____|_| \_\___|_____|_| |_|_____|
 
 Desenvolvido por: @griehl_
 Validador Oficial de conformidade PDF/A-2b
=================================================================================
*/

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process"); 
const { promisify } = require("util");

const execAsync = promisify(exec); 

// Caminho do veraPDF no seu computador
const VERAPDF_PATH = "C:\\Users\\Unespar\\verapdf\\verapdf.bat";

// Códigos de cor ANSI para o terminal
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

async function validateWithVeraPdf(pdfPath) {
    try {
        const command = `"${VERAPDF_PATH}" -f 2b --format text "${pdfPath}"`;
        const { stdout } = await execAsync(command, { windowsHide: true });
        
        const isCompliant = stdout.includes("PASS") || stdout.includes("PASSED") || stdout.includes('isCompliant="true"');
        return { isCompliant, log: stdout.trim() }; 
    } catch (error) {
        const stdout = error.stdout || "";
        const isCompliant = stdout.includes("PASS") || stdout.includes("PASSED") || stdout.includes('isCompliant="true"');
        const finalLog = stdout.trim() || error.message;
        return { isCompliant, log: finalLog };
    }
}

async function processFiles() {
    // Logo em Ciano
    console.log(`${COLOR_CYAN}%s${COLOR_RESET}`, GRIEHL_LOGO); 
    console.log(" Desenvolvido por: @griehl_");
    console.log(" >> Inspetor de Conformidade PDF/A-2b <<\n");

    const files = process.argv.slice(2);
    
    if (files.length === 0) {
        console.log(`${COLOR_YELLOW}Nenhum arquivo foi selecionado.${COLOR_RESET}`);
        return;
    }

    console.log(`🚀 Iniciando inspeção de ${files.length} arquivo(s)...\n`);

    for (const file of files) {
        try {
            const ext = path.extname(file).toLowerCase();
            if (ext !== '.pdf') {
                console.log(`${COLOR_YELLOW}[IGNORADO] Não é PDF: ${path.basename(file)}${COLOR_RESET}`);
                continue;
            }

            const originalName = path.basename(file);
            console.log(`🔎 Inspecionando: ${originalName}`);
            
            const { isCompliant, log } = await validateWithVeraPdf(file);

            if (isCompliant) {
                // APROVADO em Verde brilhante
                console.log(`${COLOR_GREEN}[APROVADO] O arquivo é um PDF/A-2b autêntico!${COLOR_RESET}`);
            } else {
                // REPROVADO em Vermelho
                console.log(`${COLOR_RED}[REPROVADO] O arquivo NÃO segue os padrões A-2b.${COLOR_RESET}`);
                
                const originalDir = path.dirname(file);
                const logPath = path.join(originalDir, `${path.basename(file, ext)}_laudo_reprovacao.txt`);
                fs.writeFileSync(logPath, log, "utf8");
                console.log(`   📝 Um laudo técnico foi salvo ao lado do arquivo.`);
            }
            console.log("---------------------------------------------------");
            
        } catch (error) {
            console.log(`${COLOR_RED}🚨 ERRO de leitura no arquivo: ${path.basename(file)}${COLOR_RESET}`);
            console.log("---------------------------------------------------");
        }
    }
    
    console.log("🎉 Inspeção concluída!");
}

processFiles();