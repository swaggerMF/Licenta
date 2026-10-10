#include <iostream>
#include <fstream>
#include <vector>
#include <chrono>
#include <charconv>
#include <optional>
#include <sstream>

class Entry{
    public:
        std::chrono::sys_seconds timestamp;
        unsigned BG;
        std::string event = "NONE";

    Entry(std::chrono::sys_seconds timestamp, unsigned BG, std::string event = "NONE"){
        this->timestamp = timestamp;
        this->BG = BG;
        this->event = event;
    }
    std::chrono::sys_seconds getTimestamp();
    unsigned getBG();
    
};

// parses CSV date "YYYY/MM/DD" and time "HH:MM:SS"; returns nothing if either is malformed or out of range
std::optional<std::chrono::sys_seconds> toTimestamp(const std::string& date, const std::string& time){
    std::istringstream dateStream(date);
    int year = 0;
    unsigned month = 0, day = 0;
    char sep1 = 0, sep2 = 0;
    dateStream >> year >> sep1 >> month >> sep2 >> day;
    if(!dateStream || sep1 != '/' || sep2 != '/'){
        return std::nullopt;
    }
    std::chrono::year_month_day ymd{std::chrono::year{year}, std::chrono::month{month}, std::chrono::day{day}};
    if(!ymd.ok()){
        return std::nullopt;
    }

    std::istringstream timeStream(time);
    unsigned hour = 0, min = 0, sec = 0;
    char tsep1 = 0, tsep2 = 0;
    timeStream >> hour >> tsep1 >> min >> tsep2 >> sec;
    if (!timeStream || tsep1 != ':' || tsep2 != ':' || hour > 23 || min > 59 || sec > 59) {
        return std::nullopt;
    }

    return std::chrono::sys_days{ymd} + std::chrono::hours{hour} + std::chrono::minutes{min} + std::chrono::seconds{sec};
}

std::vector<std::string> splitCsvLine(const std::string& line) {
    std::vector<std::string> fields;
    std::size_t start = 0;
    std::size_t semiColonPos = 0;

    while ((semiColonPos = line.find(';', start)) != std::string::npos) {
        fields.push_back(line.substr(start, semiColonPos - start));
        start = semiColonPos + 1;
    }

    fields.push_back(line.substr(start));
    return fields;
}

bool skipToSensorData(std::istream& input) {
    std::string line;
    while (std::getline(input, line)) {
        if (line.find(";Sensor;") != std::string::npos) {
            std::getline(input, line);
            return true;
        }
    }
    return false;
}

std::optional<Entry> parseEntry(const std::string& line) {
    const auto fields = splitCsvLine(line);
    if (fields.size() < 52 || fields[34].empty()) {
        return std::nullopt;
    }

    const auto timestamp = toTimestamp(fields[1], fields[2]);
    if (!timestamp) {
        return std::nullopt;
    }

    unsigned BG = 0;
    const auto [ptr, ec] = std::from_chars(fields[34].data(), fields[34].data() + fields[34].size(), BG);
    if (ec != std::errc{}) {
        return std::nullopt;
    }

    return Entry(*timestamp, BG, !fields[51].empty() ? fields[51] : "NONE");
}

std::vector<Entry> readEntries(std::istream& input) {
    std::vector<Entry> entries;

    if (!skipToSensorData(input)) {
        return entries;
    }

    std::string line;
    while (std::getline(input, line)) {
        if (const auto entry = parseEntry(line)) {
            entries.push_back(*entry);
        }
    }

    return entries;
}

void printEntries(const std::vector<Entry>& entries) {
    for (const auto& entry : entries) {
        std::cout << entry.getBG() << ' ';
    }
    std::cout << '\n';
}

int main(int argc, char** argv) {
    const std::string filePath = argc > 1 ? argv[1] : "in.csv";
    std::ifstream inFile(filePath);

    if (!inFile) {
        std::cerr << "Could not open file: " << filePath << '\n';
        return 1;
    }

    const auto entries = readEntries(inFile);
    printEntries(entries);

    return 0;
}