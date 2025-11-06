import librosa
import soundfile as sf
import os

def change_pitch_without_speed(input_file, semitones, path_num):
    """
    음정을 변경하여 새 파일로 저장합니다.
    
    Args:
        input_file: 입력 파일 이름 (확장자 제외)
        semitones: 변경할 반음 수 (양수: 올림, 음수: 내림)
        path_num: 0=front-end/public/mr, 1=assets/audio/artist/vocal
    
    Returns:
        output_file: 생성된 출력 파일의 절대 경로
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    file_path = ''
    output_file = ''
    if path_num == 0:
        mr_dir = os.path.join(base_dir, "../front-end/public/mr")
        file_path = os.path.join(mr_dir, f"{input_file}.wav")
        if semitones >= 0:
            output_file = os.path.join(mr_dir, f"{input_file}+{semitones}.wav")
        else:
            output_file = os.path.join(mr_dir, f"{input_file}{semitones}.wav")
    elif path_num == 1:
        file_path = f"assets/audio/artist/vocal/{input_file}.wav"
        if semitones >= 0:
            output_file = f"assets/audio/artist/vocal/{input_file}+{semitones}.wav"
        else:
            output_file = f"assets/audio/artist/vocal/{input_file}{semitones}.wav"
    
    file_path = os.path.normpath(file_path)
    output_file = os.path.normpath(output_file)
    
    # 출력 디렉토리가 없으면 생성
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    
    # 오디오 로드 및 피치 변경
    y, sr = librosa.load(file_path)
    y_shifted = librosa.effects.pitch_shift(y, sr=sr, n_steps=semitones)
    sf.write(output_file, y_shifted, sr)
    
    # 생성된 파일의 절대 경로 반환
    return os.path.abspath(output_file)

if __name__=="__main__":
        
    # 파일 경로
    vocal_file = "assets/audio/artist/vocal/"
    inst_file = "assets/audio/artist/inst/"

    output_file = r"C:\Git\ai_vocal_training\output_semitone_up.wav"

    # 반음 올리기 (semitones에 양수 값을 주면 음이 올라감)
    semitones = 4  # 1이면 반음 올리기, -1이면 반음 내리기

    # 음정 변경 및 속도 유지
    change_pitch_without_speed(input_file, output_file, semitones)
