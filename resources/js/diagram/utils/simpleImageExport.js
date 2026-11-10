// resources/js/diagram/utils/simpleImageExport.js
// Exportación simple de diagramas a PNG/JPG

import html2canvas from 'html2canvas';
import { alertDialog } from './modal.js';

export class SimpleImageExporter {
    constructor(editor) {
        this.editor = editor;
    }

    async exportToPNG() {
        try {
            console.log('📸 Iniciando exportación a PNG...');

            const canvas = await this.captureCanvas();
            this.downloadImage(canvas, 'diagram.png', 'image/png');

            console.log('✅ Exportación PNG completada');
        } catch (error) {
            console.error('❌ Error en exportación PNG:', error);
            alertDialog({ tone: 'error', title: 'No se pudo exportar la imagen', message: error.message });
        }
    }

    async exportToJPG() {
        try {
            console.log('📸 Iniciando exportación a JPG...');

            const canvas = await this.captureCanvas();
            this.downloadImage(canvas, 'diagram.jpg', 'image/jpeg');

            console.log('✅ Exportación JPG completada');
        } catch (error) {
            console.error('❌ Error en exportación JPG:', error);
            alertDialog({ tone: 'error', title: 'No se pudo exportar la imagen', message: error.message });
        }
    }

    async captureCanvas() {
        // Obtener el contenedor del papel/diagrama
        const paperContainer = this.editor.paper.el;

        // Configuración optimizada para diagramas UML
        const options = {
            backgroundColor: '#ffffff',
            width: paperContainer.scrollWidth,
            height: paperContainer.scrollHeight,
            scale: 2, // Alta resolución
            useCORS: true,
            allowTaint: false,
            imageTimeout: 10000,
            removeContainer: true
        };

        console.log('🎯 Capturando canvas con dimensiones:', options.width, 'x', options.height);

        const canvas = await html2canvas(paperContainer, options);
        return canvas;
    }

    downloadImage(canvas, filename, mimeType) {
        // Convertir canvas a blob
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);

            // Crear enlace temporal para descarga
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;

            // Trigger descarga
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Limpiar URL temporal
            setTimeout(() => URL.revokeObjectURL(url), 100);

            console.log('📥 Descarga iniciada:', filename);
        }, mimeType, 0.95); // Calidad 95%
    }

    // Método rápido para PNG (usado desde botones)
    static quickExportPNG(editor) {
        const exporter = new SimpleImageExporter(editor);
        exporter.exportToPNG();
    }

    // Método rápido para JPG (usado desde botones)
    static quickExportJPG(editor) {
        const exporter = new SimpleImageExporter(editor);
        exporter.exportToJPG();
    }
}
