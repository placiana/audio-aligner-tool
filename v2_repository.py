import database

def get_v2_project_data(project_id, user_id):
    project = database.get_project(project_id, user_id)
    if not project:
        return None
    
    v2_data = database.get_v2_project_full(project_id)
    if v2_data:
        project["v2_data"] = v2_data
    return project

def import_project_json(project_id, json_data):
    return database.import_v2_project_from_json(project_id, json_data)

def export_project_json(project_id):
    return database.export_v2_project_to_json(project_id)

def create_match_group(project_id, segment_ids):
    return database.create_v2_match(project_id, segment_ids)

def remove_match_group(match_id):
    return database.delete_v2_match(match_id)

def update_segment_data(segment_id, start_time=None, end_time=None, text_content=None):
    if start_time is not None and end_time is not None:
        database.update_v2_segment_bounds(segment_id, start_time, end_time)
    if text_content is not None:
        database.update_v2_segment_text(segment_id, text_content)
    return True

def update_channel_data(channel_id, name, channel_type):
    database.update_v2_channel(channel_id, name, channel_type)
    return True

def add_channel_media(channel_id, filename, media_type="audio"):
    return database.add_v2_media(channel_id, filename, media_type)

def save_media_segments(media_id, channel_id, segments):
    return database.save_v2_media_segments(media_id, channel_id, segments)

def add_channel(project_id, name, channel_type):
    return database.add_v2_channel(project_id, name, channel_type)

def delete_channel(channel_id):
    return database.delete_v2_channel(channel_id)

def import_tabular_csv_media(project_id, filename, csv_content, column_mappings, delimiter=','):
    return database.import_tabular_csv_media(project_id, filename, csv_content, column_mappings, delimiter)




