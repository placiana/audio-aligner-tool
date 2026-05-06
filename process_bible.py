import json
import os

def process_bible(input_file, output_dir):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    for entry in data:
        book_code = entry.get('book_code')
        chapter = entry.get('chapter')
        verses = entry.get('verses', [])
        
        # Concatenate verse texts with two newlines
        chapter_text = "\n\n".join([v.get('text', '') for v in verses])
        
        # Create filename: BOOK_CHAPTER.txt
        filename = f"{book_code}_{chapter}.txt"
        file_path = os.path.join(output_dir, filename)
        
        with open(file_path, 'w', encoding='utf-8') as out_f:
            out_f.write(chapter_text)
        
    print(f"Processed {len(data)} chapters into {output_dir}")

if __name__ == "__main__":
    process_bible('processed_data.json', 'uploads/texts')
