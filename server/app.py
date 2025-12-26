import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from datetime import datetime
from pymongo import MongoClient

load_dotenv()

app = Flask(__name__)
CORS(app)

# MongoDB setup
MONGO_URI = os.getenv("MONGO_URI")
client = MongoClient(MONGO_URI)
db = client['productivity_tracker']
history_collection = db['browsing_history']

def get_llm():
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None
    return ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=api_key, temperature=0)

@app.route('/status', methods=['GET'])
def status():
    return jsonify({"status": "running", "database": "mongodb"})

@app.route('/classify', methods=['POST'])
def classify_sites():
    llm = get_llm()
    if not llm:
        return jsonify({"error": "GOOGLE_API_KEY not found"}), 500

    data = request.json
    history = data.get('history', [])

    if not history:
        return jsonify({"productive_time": 0, "distracting_time": 0, "details": []})

    # 1. Aggregate
    aggregated = {}
    for item in history:
        title = item.get('title', 'Unknown')
        url = item.get('url', '')
        duration = item.get('duration', 0)
        
        if title not in aggregated:
            aggregated[title] = {'duration': 0, 'urls': set()}
        aggregated[title]['duration'] += duration
        aggregated[title]['urls'].add(url)

    # 2. Classify
    titles_list = list(aggregated.keys())
    lines = [f"{i+1}. {title}" for i, title in enumerate(titles_list)]
    list_str = "\n".join(lines)
    
    prompt_text = (
        "You are a productivity assistant. Classify these website titles as 'Productive' or 'Distracting'. "
        "If you are unsure, default to 'Productive' if it looks work-related (docs, email, tools) and 'Distracting' for entertainment/social media. "
        "It is productive if the site is related to learning even if it is youtube. But the same youtube site can be a distraction if it is not related to learning. "
        "Return a JSON object where keys are the titles and values are the classification.\n\n"
        f"List:\n{list_str}\n\n"
        "Output JSON only."
    )
    
    try:
        response = llm.invoke(prompt_text)
        content = response.content.replace("```json", "").replace("```", "").strip()
        import json
        classifications = json.loads(content)
    except Exception as e:
        print(f"LLM Error: {e}")
        classifications = {}

    # 3. Build Report and Save
    productive_time = 0
    distracting_time = 0
    details = []
    
    records_to_insert = []
    timestamp = datetime.utcnow()

    for title, info in aggregated.items():
        cat = classifications.get(title, "Distracting")
        is_productive = "productive" in cat.lower()
        final_cat = "Productive" if is_productive else "Distracting"
        
        if is_productive:
            productive_time += info['duration']
        else:
            distracting_time += info['duration']
            
        detail = {
            "title": title,
            "urls": list(info['urls']),
            "duration": info['duration'],
            "classification": final_cat,
            "timestamp": timestamp
        }
        details.append(detail)
        records_to_insert.append(detail)

    # Save to MongoDB
    if records_to_insert:
        history_collection.insert_many(records_to_insert)
        # Convert ObjectId to string for JSON serialization
        for item in records_to_insert:
            if "_id" in item:
                item["_id"] = str(item["_id"])
            if "timestamp" in item:
                item["timestamp"] = item["timestamp"].isoformat()

    details.sort(key=lambda x: x['duration'], reverse=True)

    # Calculate Today's Totals
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}}},
        {"$group": {
            "_id": "$classification",
            "total_duration": {"$sum": "$duration"}
        }}
    ]
    totals = list(history_collection.aggregate(pipeline))
    
    today_prod = 0
    today_dist = 0
    for t in totals:
        if t['_id'] == 'Productive':
            today_prod = t['total_duration']
        else:
            today_dist = t['total_duration']

    return jsonify({
        "current_session": {
            "productive_time": productive_time,
            "distracting_time": distracting_time,
            "details": details
        },
        "today_total": {
            "productive_time": today_prod,
            "distracting_time": today_dist
        }
    })

@app.route('/history', methods=['GET'])
def get_history():
    rows = list(history_collection.find().sort("timestamp", -1).limit(100))
    for row in rows:
        row['_id'] = str(row['_id'])
        if "timestamp" in row and isinstance(row["timestamp"], datetime):
            row["timestamp"] = row["timestamp"].isoformat()
    return jsonify(rows)

@app.route('/clear', methods=['POST'])
def clear_history():
    history_collection.delete_many({})
    return jsonify({"message": "MongoDB history wiped"})

if __name__ == '__main__':
    app.run(port=5000, debug=True)
