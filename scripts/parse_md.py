import os
import re
import json
import base64

def parse_md_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Extract Subject Title
    subject_match = re.search(r'### 📋 (.*?) 主題索引表', content)
    subject_title = subject_match.group(1).strip() if subject_match else os.path.basename(file_path).replace('.md', '')

    # 2. Extract Categories
    categories = []
    index_table_match = re.search(r'\| 類別 \| 題號 \|.*?\| :--- \| :--- \|(.*?)\n---', content, re.DOTALL)
    if index_table_match:
        rows = index_table_match.group(1).strip().split('\n')
        for row in rows:
            cols = row.split('|')
            if len(cols) >= 3:
                cat_name = cols[1].replace('**', '').strip()
                range_str = cols[2].strip()
                range_match = re.search(r'(\d+)\s*-\s*(\d+)', range_str)
                if range_match:
                    categories.append({
                        "name": cat_name,
                        "start": int(range_match.group(1)),
                        "end": int(range_match.group(2))
                    })

    # 3. Extract Questions
    questions = []
    q_blocks = re.findall(r'#### \*\*第 (\d+) 題\*\*(.*?)(?=(?:#### \*\*第 \d+ 題\*\*|---|$))', content, re.DOTALL)
    
    file_prefix = os.path.basename(file_path).replace('.md', '').replace(' ', '_')

    for q_num_str, q_body in q_blocks:
        q_num = int(q_num_str)
        
        # Unique ID based on file and question number
        q_id = f"{file_prefix}_{q_num:03d}"

        # Extract Question Text and Options
        q_text_match = re.search(r'\*\*題目：\*\*(.*?)\(A\)', q_body, re.DOTALL)
        q_text = q_text_match.group(1).strip() if q_text_match else ""
        
        options = {}
        for opt in ['A', 'B', 'C', 'D']:
            opt_pattern = rf'\({opt}\)\s*(.*?)(?=\s*\([B-D]\)|$|>|\n\n)'
            opt_match = re.search(opt_pattern, q_body, re.DOTALL)
            if opt_match:
                options[opt] = opt_match.group(1).strip()

        # Extract Meta
        ans_match = re.search(r'> \*\*答案：\*\*\s*[`*]*([A-D#])[`*]*', q_body)
        answer = ans_match.group(1) if ans_match else ""
        
        hint_match = re.search(r'> \*\*💡 一句話判斷：\*\*(.*?)\n', q_body)
        hint = hint_match.group(1).strip() if hint_match else ""
        
        expl_match = re.search(r'> \*\*📋 選項專業解析：\*\*(.*?)(?=> \*\*⚠️|$)', q_body, re.DOTALL)
        explanation = expl_match.group(1).strip() if expl_match else ""
        
        warn_match = re.search(r'> \*\*⚠️ 易錯提醒：\*\*(.*?)(?=\n\d+年|$)', q_body, re.DOTALL)
        warning = warn_match.group(1).strip() if warn_match else ""
        
        # Categorize
        q_category = "未分類"
        for cat in categories:
            if cat['start'] <= q_num <= cat['end']:
                q_category = cat['name']
                break

        questions.append({
            "id": q_id,
            "subject": subject_title,
            "category": q_category,
            "question": q_text,
            "options": options,
            "answer": answer,
            "hint": hint,
            "explanation": explanation,
            "warning": warning
        })

    return {
        "title": subject_title,
        "questions": questions
    }

def main():
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
    
    all_questions = []
    subjects_info = []

    for f in files:
        file_path = os.path.join(base_dir, f)
        if os.path.exists(file_path):
            print(f"Parsing {f}...")
            data = parse_md_file(file_path)
            all_questions.extend(data['questions'])
            subjects_info.append({
                "id": os.path.basename(f).replace('.md', ''),
                "title": data['title'],
                "count": len(data['questions'])
            })
        else:
            print(f"Warning: {file_path} not found.")

    final_data = {
        "subjects": subjects_info,
        "questions": all_questions
    }

    # Output files
    data_dir = os.path.join(app_dir, 'data')
    if not os.path.exists(data_dir): os.makedirs(data_dir)

    # 1. JSON
    with open(os.path.join(data_dir, 'questions.json'), 'w', encoding='utf-8') as out_f:
        json.dump(final_data, out_f, ensure_ascii=False, indent=2)
    
    # 2. Base64 DAT
    json_str = json.dumps(final_data, ensure_ascii=False, separators=(',', ':'))
    encoded = base64.b64encode(json_str.encode('utf-8'))
    with open(os.path.join(data_dir, 'questions.dat'), 'wb') as out_f:
        out_f.write(encoded)
        
    print(f"Successfully processed {len(all_questions)} questions across {len(subjects_info)} subjects.")

if __name__ == "__main__":
    main()
