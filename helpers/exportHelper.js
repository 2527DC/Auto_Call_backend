const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel } = require('docx');

exports.generatePDF = (data, columns, title) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                let pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            doc.fontSize(20).text(title, { align: 'center' });
            doc.moveDown();

            const startX = 50;
            let currentY = doc.y;
            const colWidth = (doc.page.width - 100) / columns.length;

            doc.fontSize(12).fillColor('black');
            columns.forEach((col, i) => {
                doc.text(col.header, startX + i * colWidth, currentY, { width: colWidth, align: 'left' });
            });

            doc.moveTo(startX, currentY + 15).lineTo(doc.page.width - 50, currentY + 15).stroke();
            currentY += 25;

            doc.fontSize(10);
            data.forEach((row) => {
                if (currentY > doc.page.height - 50) {
                    doc.addPage();
                    currentY = 50;
                }
                columns.forEach((col, i) => {
                    const value = row[col.key] || '';
                    doc.text(String(value), startX + i * colWidth, currentY, { width: colWidth, align: 'left' });
                });
                currentY += 20;
            });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

exports.generateExcel = async (data, columns, sheetName) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    worksheet.columns = columns.map(col => ({
        header: col.header,
        key: col.key,
        width: 20
    }));

    worksheet.addRows(data);
    worksheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
};

exports.generateWord = async (data, columns, title) => {
    const tableHeader = new TableRow({
        children: columns.map(col => new TableCell({
            children: [new Paragraph({ text: col.header, bold: true })],
            width: { size: 100 / columns.length, type: WidthType.PERCENTAGE },
        })),
    });

    const tableRows = data.map(row => new TableRow({
        children: columns.map(col => new TableCell({
            children: [new Paragraph({ text: String(row[col.key] || '') })],
            width: { size: 100 / columns.length, type: WidthType.PERCENTAGE },
        })),
    }));

    const table = new Table({
        rows: [tableHeader, ...tableRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
    });

    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({
                    text: title,
                    heading: HeadingLevel.HEADING_1,
                    alignment: AlignmentType.CENTER,
                }),
                new Paragraph({ text: "" }),
                table,
            ],
        }],
    });

    const buffer = await Packer.toBuffer(doc);
    return buffer;
};
exports.generateCSV = async (data, columns) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data');

    worksheet.columns = columns.map(col => ({
        header: col.header,
        key: col.key
    }));

    worksheet.addRows(data);

    const buffer = await workbook.csv.writeBuffer();
    return buffer;
};
