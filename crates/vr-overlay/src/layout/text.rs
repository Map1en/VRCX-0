pub fn ellipsize_to_width(text: &str, max_width: f32, font_size: f32) -> String {
    let max_width = max_width.max(1.0);
    let mut output = String::new();
    let mut widths = Vec::new();
    let mut width = 0.0;
    let mut truncated = false;

    for ch in text.chars() {
        let char_width = estimated_char_width(ch, font_size);
        if width + char_width > max_width {
            truncated = true;
            break;
        }
        output.push(ch);
        widths.push(char_width);
        width += char_width;
    }

    if !truncated {
        return text.to_string();
    }

    let ellipsis_width = estimated_char_width('…', font_size);
    while !widths.is_empty() && width + ellipsis_width > max_width {
        width -= widths.pop().unwrap_or_default();
        output.pop();
    }
    if output.is_empty() {
        return "…".to_string();
    }
    output.push('…');
    output
}

fn estimated_char_width(ch: char, font_size: f32) -> f32 {
    let factor = if ch.is_ascii() { 0.55 } else { 1.0 };
    (font_size * factor).max(1.0)
}
