#include <iostream>
#include <fstream>
#include <vector>
#include <chrono>
#include <charconv>
#include <optional>
#include <sstream>
#include <iomanip>

class Entry{
    public:
        std::chrono::sys_seconds timestamp;
        std::optional<unsigned> BG;
        std::string event = "NONE";

    Entry(std::chrono::sys_seconds timestamp, std::optional<unsigned> BG, std::string event = "NONE"){
        this->timestamp = timestamp;
        this->BG = BG;
        this->event = event;
    }
    std::chrono::sys_seconds getTimestamp() const;
    std::optional<unsigned> getBG() const;
    const std::string& getEvent() const;
};

inline std::chrono::sys_seconds Entry::getTimestamp() const { return timestamp; }
inline std::optional<unsigned> Entry::getBG() const { return BG; }
inline const std::string& Entry::getEvent() const { return event; }

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
    if (fields.size() < 52) {
        return std::nullopt;
    }

    const auto timestamp = toTimestamp(fields[1], fields[2]);
    if (!timestamp) {
        return std::nullopt;
    }

    if (fields[34].empty()) {
        return Entry(*timestamp, std::nullopt, !fields[51].empty() ? fields[51] : "NONE");
    }

    unsigned BG = 0;
    const auto [ptr, ec] = std::from_chars(fields[34].data(), fields[34].data() + fields[34].size(), BG);
    if (ec != std::errc{} || ptr != fields[34].data() + fields[34].size()) {
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
        if (entry.getBG()) std::cout << *entry.getBG() << ' ';
    }
    std::cout << '\n';
}

void printJsonEntries(const std::vector<Entry>& entries) {
    std::cout << '[';
    bool first = true;
    for (const auto& entry : entries) {
        if (!first) std::cout << ',';
        first = false;
        const auto day = std::chrono::floor<std::chrono::days>(entry.timestamp);
        const std::chrono::year_month_day date{day};
        const std::chrono::hh_mm_ss time{entry.timestamp - day};
        std::cout << "{\"date\":\"" << int(date.year()) << '-'
                  << std::setfill('0') << std::setw(2) << unsigned(date.month()) << '-'
                  << std::setw(2) << unsigned(date.day()) << "\",\"time\":\""
                  << std::setw(2) << time.hours().count() << ':'
                  << std::setw(2) << time.minutes().count() << ':'
                  << std::setw(2) << time.seconds().count()
                  << "\",\"bg\":";
        if (entry.BG) std::cout << *entry.BG;
        else std::cout << "null";
        std::cout << ",\"event\":\"";
        for (const unsigned char character : entry.event) {
            if (character == '"' || character == '\\') std::cout << '\\' << character;
            else if (character < 32) {
                std::cout << "\\u00" << std::hex << std::setw(2) << int(character) << std::dec;
            } else std::cout << character;
        }
        std::cout << "\"}";
    }
    std::cout << "]\n";
}

int main(int argc, char** argv) {
    const std::string filePath = argc > 1 ? argv[1] : "in.csv";
    std::ifstream inFile(filePath);

    if (!inFile) {
        std::cerr << "Could not open file: " << filePath << '\n';
        return 1;
    }

    const auto entries = readEntries(inFile);
    if (argc > 2 && std::string(argv[2]) == "--json") printJsonEntries(entries);
    else printEntries(entries);

    return 0;
}
