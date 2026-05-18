import os
import re
import json

def parse_md_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Extract Subject Title
    subject_match = re.search(r'### 📋 (.*?) 主題索引表', content)
    subject_title = subject_match.group(1).strip() if subject_match else os.path.basename(file_path)

    # 2. Extract Index Table for Categories
    # Format: | **Category Name** | 1 - 29 |
    categories = []
    index_table_match = re.search(r'\| 類別 \| 題號 \|.*?\| :--- \| :--- \|(.*?)\n---', content, re.DOTALL)
    if index_table_match:
        rows = index_table_match.group(1).strip().split('\n')
        for row in rows:
            cols = row.split('|')
            if len(cols) >= 3:
                cat_name = cols[1].replace('**', '').strip()
                range_str = cols[2].strip()
                # Parse range like "1 - 29" or "161 - 167"
                range_match = re.search(r'(\d+)\s*-\s*(\d+)', range_str)
                if range_match:
                    categories.append({
                        "name": cat_name,
                        "start": int(range_match.group(1)),
                        "end": int(range_match.group(2))
                    })

    # 3. Extract Questions
    # Pattern to find each question block
    # #### **第 X 題** ... [Tags]
    questions = []
    q_blocks = re.findall(r'#### \*\*第 (\d+) 題\*\*(.*?)(?=(?:#### \*\*第 \d+ 題\*\*|---|$))', content, re.DOTALL)
    
    for q_num_str, q_body in q_blocks:
        q_num = int(q_num_str)
        
        # Extract Question Text and Options
        # **題目：** ... (A) ... (B) ... (C) ... (D) ...
        q_text_match = re.search(r'\*\*題目：\*\*(.*?)\(A\)', q_body, re.DOTALL)
        q_text = q_text_match.group(1).strip() if q_text_match else ""
        
        options = {}
        for opt in ['A', 'B', 'C', 'D']:
            opt_pattern = rf'\({opt}\)\s*(.*?)(?=\s*\([B-D]\)|$|>|\n\n)'
            opt_match = re.search(opt_pattern, q_body, re.DOTALL)
            if opt_match:
                options[opt] = opt_match.group(1).strip()

        # Extract Answer, Hint, Explanation, Warning
        ans_match = re.search(r'> \*\*答案：\*\*\s*[`*]*([A-D#])[`*]*', q_body)
        answer = ans_match.group(1) if ans_match else ""
        
        hint_match = re.search(r'> \*\*💡 一句話判斷：\*\*(.*?)\n', q_body)
        hint = hint_match.group(1).strip() if hint_match else ""
        
        # Explanation can be multi-line
        expl_match = re.search(r'> \*\*📋 選項專業解析：\*\*(.*?)(?=> \*\*⚠️|$)', q_body, re.DOTALL)
        explanation = expl_match.group(1).strip() if expl_match else ""
        
        warn_match = re.search(r'> \*\*⚠️ 易錯提醒：\*\*(.*?)(?=\n\d+年|$)', q_body, re.DOTALL)
        warning = warn_match.group(1).strip() if warn_match else ""
        
        tag_match = re.search(r'(\d+年｜.*?｜.*?)$', q_body.strip())
        tags = tag_match.group(1).strip() if tag_match else ""

        # Map to category based on q_num
        q_category = "未分類"
        for cat in categories:
            if cat['start'] <= q_num <= cat['end']:
                q_category = cat['name']
                break

        questions.append({
            "id": f"{os.path.basename(file_path)}_{q_num}",
            "num": q_num,
            "category": q_category,
            "question": q_text,
            "options": options,
            "answer": answer,
            "hint": hint,
            "explanation": explanation,
            "warning": warning,
            "tags": tags
        })

    return {
        "title": subject_title,
        "categories": categories,
        "questions": questions
    }

def main():
    # Use relative path to ensure it works in the app-2.0 structure
    script_dir = os.path.dirname(os.path.abspath(__file__))
    base_dir = os.path.abspath(os.path.join(script_dir, '..', '..'))
    app_dir = os.path.abspath(os.path.join(script_dir, '..'))
    
    files = [
        '01_衛生法規及倫理_選擇題_索引分類.md',
        '02_生物統計學__選擇題_索引分類.md',
        '03_流行病學__選擇題_索引分類.md',
        '04_衛生行政與管理__選擇題_索引分類.md',
        '05_環境與職業衛生__選擇題_索引分類.md',
        '06_健康社會行為學__選擇題_索引分類.md'
    ]
    
    all_data = {}
    global_q_counter = 1
    
    for f in files:
        file_path = os.path.join(base_dir, f)
        if os.path.exists(file_path):
            print(f"Parsing {f}...")
            subject_data = parse_md_file(file_path)
            
            # Inject global IDs
            for q in subject_data['questions']:
                q['id'] = f"Q_{global_q_counter:04d}"
                global_q_counter += 1
                
            all_data[f] = subject_data
        else:
            print(f"Warning: {file_path} not found.")

    data_dir = os.path.join(app_dir, 'data')
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)

    # 1. Output to JSON (for debugging)
    output_json_path = os.path.join(data_dir, 'questions.json')
    with open(output_json_path, 'w', encoding='utf-8') as out_f:
        json.dump(all_data, out_f, ensure_ascii=False, indent=2)
    
    # 2. Output to Base64 encoded DAT file
    import base64
    output_dat_path = os.path.join(data_dir, 'questions.dat')
    json_str = json.dumps(all_data, ensure_ascii=False, separators=(',', ':'))
    encoded_bytes = base64.b64encode(json_str.encode('utf-8'))
    
    with open(output_dat_path, 'wb') as out_f:
        out_f.write(encoded_bytes)
        
    print(f"Successfully saved to {output_json_path}")
    print(f"Successfully saved to {output_dat_path} (Obfuscated)")

if __name__ == "__main__":
    main()
