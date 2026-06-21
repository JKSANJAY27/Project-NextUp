import fitz
import html
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

pdf_path = "D:/Sanjay/B.Tech CSE/Resume - Sanjay J K.pdf"
doc = fitz.open(pdf_path)
page = doc.load_page(0)

# Get links and words
links = page.get_links()
words = page.get_text("words")

print("--- RAW LINKS ---")
for l in links:
    print(l)

rect_links = []
for l in links:
    if "uri" in l and "from" in l:
        rect_links.append((fitz.Rect(l["from"]), l["uri"]))

lines_dict = {}
for w in words:
    x0, y0, x1, y1, word, block_no, line_no, word_no = w
    key = (block_no, line_no)
    if key not in lines_dict:
        lines_dict[key] = []
    lines_dict[key].append(w)
    
sorted_keys = sorted(lines_dict.keys(), key=lambda k: (lines_dict[k][0][1], lines_dict[k][0][0]))
used_link_rect_keys = set()
page_text_lines = []

for key in sorted_keys:
    line_words = sorted(lines_dict[key], key=lambda w: w[0])
    line_text = ""
    i = 0
    while i < len(line_words):
        w = line_words[i]
        x0, y0, x1, y1, word, _, _, _ = w
        word_rect = fitz.Rect(x0, y0, x1, y1)
        
        matched_uri = None
        matched_rect = None
        matched_rect_key = None
        for l_rect, uri in rect_links:
            if word_rect.intersects(l_rect) or l_rect.contains(word_rect):
                matched_uri = uri
                matched_rect = l_rect
                matched_rect_key = (round(l_rect.x0, 1), round(l_rect.y0, 1), round(l_rect.x1, 1), round(l_rect.y1, 1))
                break
                
        if matched_uri and matched_rect_key not in used_link_rect_keys:
            linked_words = [word]
            j = i + 1
            while j < len(line_words):
                nw = line_words[j]
                nx0, ny0, nx1, ny1, nword, _, _, _ = nw
                nword_rect = fitz.Rect(nx0, ny0, nx1, ny1)
                if nword_rect.intersects(matched_rect) or matched_rect.contains(nword_rect):
                    linked_words.append(nword)
                    j += 1
                else:
                    break
            
            phrase = " ".join(linked_words)
            clean_uri = matched_uri.strip()
            if phrase.strip().lower() == clean_uri.lower() or phrase.strip().lower() in clean_uri.lower():
                line_text += f"{phrase} "
            else:
                line_text += f"{phrase} ({clean_uri}) "
            used_link_rect_keys.add(matched_rect_key)
            i = j
        elif matched_uri and matched_rect_key in used_link_rect_keys:
            line_text += f"{word} "
            i += 1
        else:
            line_text += f"{word} "
            i += 1
    page_text_lines.append(line_text.strip())

extracted_text = "\n".join(page_text_lines) + "\n"
print("\n--- BEFORE HTML CLEANING ---")
print(extracted_text)

# Let's run cleaning steps one by one
text = html.unescape(extracted_text)
print("\n--- AFTER UNESCAPE ---")
# Let's see if there is any <[^>]*> match
print("Matches for <[^>]*>:")
print(re.findall(r'<[^>]*>', text))
text = re.sub(r'<[^>]*>', ' ', text)

print("Matches for dangle/broken tag format:")
print(re.findall(r'</?\w+\b[^>]*>?', text))
text = re.sub(r'</?\w+\b[^>]*>?', ' ', text)

print("Matches for attributes:")
print(re.findall(r'\b(style|class|id|href|src|align|valign|width|height|color|font|family|size|target|rel)=["\'][^"\']*["\']', text))
text = re.sub(r'\b(style|class|id|href|src|align|valign|width|height|color|font|family|size|target|rel)=["\'][^"\']*["\']', ' ', text)

print("Matches for common HTML tag words:")
print(re.findall(r'\b(strong|span|style|br|div|li|ul|p|ol|html|body|head|titleDescription)\b', text, flags=re.IGNORECASE))
text = re.sub(r'\b(strong|span|style|br|div|li|ul|p|ol|html|body|head|titleDescription)\b', ' ', text, flags=re.IGNORECASE)

print("\n--- FINAL CLEANED ---")
print(text)
