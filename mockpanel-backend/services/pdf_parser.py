from __future__ import annotations
import fitz  # PyMuPDF
from typing import Optional


class PDFParser:
    """PDF text extraction service using PyMuPDF"""

    def __init__(self):
        pass

    def extract_text(self, pdf_bytes: bytes) -> str:
        """
        Extract text from PDF bytes
        Returns empty string if extraction fails
        """
        if not pdf_bytes:
            return ""

        try:
            # Open PDF from bytes
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")

            if doc.page_count == 0:
                return ""

            text_parts = []

            # Extract text from each page
            for page_num in range(min(doc.page_count, 50)):  # Limit to first 50 pages
                page = doc.load_page(page_num)
                page_text = page.get_text()

                if page_text.strip():
                    text_parts.append(page_text.strip())

            doc.close()

            # Join all text parts
            full_text = "\n\n".join(text_parts)

            # Clean up the text
            full_text = self._clean_text(full_text)

            return full_text

        except Exception as e:
            print(f"PDF extraction error: {e}")
            return ""

    def _clean_text(self, text: str) -> str:
        """Clean and normalize extracted text"""
        if not text:
            return ""

        # Remove excessive whitespace
        import re
        text = re.sub(r'\n\s*\n\s*\n', '\n\n', text)  # Multiple newlines to double
        text = re.sub(r'[ \t]+', ' ', text)  # Multiple spaces to single

        # Remove control characters but keep newlines
        text = ''.join(char for char in text if char.isprintable() or char in '\n\t')

        return text.strip()

    @staticmethod
    def extract_text_from_pdf_bytes(data: bytes) -> str:
        """
        Legacy function for backward compatibility
        """
        parser = PDFParser()
        return parser.extract_text(data)

