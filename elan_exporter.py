import xml.etree.ElementTree as ET
from datetime import datetime
import os

def export_elan_xml(audio_name, segments):
    """
    Generates a valid ELAN (.eaf) XML document string for the given segments.
    segments: list of dicts with keys: 'start', 'end', 'text'
    """
    # Root element
    root = ET.Element("ANNOTATION_DOCUMENT", {
        "AUTHOR": "Audio Aligner Tool",
        "DATE": datetime.now().isoformat(),
        "FORMAT": "3.0",
        "VERSION": "3.0",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xsi:noNamespaceSchemaLocation": "http://www.mpi.nl/tools/elan/EAFv3.0.xsd"
    })
    
    # Header element
    header = ET.SubElement(root, "HEADER", {
        "MEDIA_FILE": "",
        "TIME_UNITS": "milliseconds"
    })
    
    # Media descriptor (assuming relative local path)
    ET.SubElement(header, "MEDIA_DESCRIPTOR", {
        "MEDIA_URL": f"file:///{audio_name}",
        "MIME_TYPE": "audio/x-wav" if audio_name.endswith('.wav') else "audio/mpeg",
        "RELATIVE_MEDIA_URL": f"./{audio_name}"
    })
    
    # Time order element
    time_order = ET.SubElement(root, "TIME_ORDER")
    
    # Generate timeslots
    time_slots = []
    # To keep timeslot IDs unique and ordered
    ts_counter = 1
    
    # Each segment has a start and end time. We want to list all of them in order.
    # To make it simple, we create two timeslots per segment.
    # ELAN expects timestamps in integer milliseconds.
    
    for i, seg in enumerate(segments):
        start_ms = int(float(seg['start']) * 1000)
        end_ms = int(float(seg['end']) * 1000)
        
        ts_start_id = f"ts{ts_counter}"
        ts_counter += 1
        ts_end_id = f"ts{ts_counter}"
        ts_counter += 1
        
        ET.SubElement(time_order, "TIME_SLOT", {
            "TIME_SLOT_ID": ts_start_id,
            "TIME_VALUE": str(start_ms)
        })
        ET.SubElement(time_order, "TIME_SLOT", {
            "TIME_SLOT_ID": ts_end_id,
            "TIME_VALUE": str(end_ms)
        })
        
        time_slots.append((ts_start_id, ts_end_id))
        
    # Tier element
    tier = ET.SubElement(root, "TIER", {
        "LINGUISTIC_TYPE_REF": "default-lt",
        "TIER_ID": "Transcription"
    })
    
    # Add annotations
    for i, seg in enumerate(segments):
        ts_start_id, ts_end_id = time_slots[i]
        text = seg.get('text', '').strip()
        
        ann = ET.SubElement(tier, "ANNOTATION")
        align_ann = ET.SubElement(ann, "ALIGNABLE_ANNOTATION", {
            "ANNOTATION_ID": f"a{i+1}",
            "TIME_SLOT_REF1": ts_start_id,
            "TIME_SLOT_REF2": ts_end_id
        })
        ann_val = ET.SubElement(align_ann, "ANNOTATION_VALUE")
        ann_val.text = text
        
    # Linguistic type descriptor
    ET.SubElement(root, "LINGUISTIC_TYPE", {
        "GRAPHIC_REFERENCES": "false",
        "LINGUISTIC_TYPE_ID": "default-lt",
        "TIME_ALIGNABLE": "true"
    })
    
    # Common ELAN constraints
    constraints = [
        ("Time_Subdivision", "Time subdivision of parent annotation's time interval, no time gaps allowed within the parent annotation's time interval"),
        ("Symbolic_Subdivision", "Symbolic subdivision of a parent annotation. Annotations refer to a single parent annotation and order is relevant"),
        ("Symbolic_Association", "1-1 association with a parent annotation"),
        ("Included_In", "Time alignable, but close to parent annotation's time-interval, gaps are allowed")
    ]
    for name, desc in constraints:
        ET.SubElement(root, "CONSTRAINT", {
            "CONSTRAINTS": name,
            "DESCRIPTION": desc
        })
        
    # Generate pretty-printed XML string
    rough_string = ET.tostring(root, 'utf-8')
    # Use mini dom or simple string conversions for nice output format
    import xml.dom.minidom
    reparsed = xml.dom.minidom.parseString(rough_string)
    return reparsed.toprettyxml(indent="    ")
